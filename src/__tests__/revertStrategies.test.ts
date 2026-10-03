import { describe, it, expect } from "vitest";
import { getRevertStrategy, createRevertContext } from "../stores/revertStrategies";
import type { AuditLog } from "../types";

describe("getRevertStrategy", () => {
  const tables = ["workers", "attendance", "daily_metrics", "payments"] as const;
  const actions = ["INSERT", "UPDATE", "DELETE"] as const;

  for (const table of tables) {
    for (const action of actions) {
      it(`returns a strategy for ${action}:${table}`, () => {
        const strategy = getRevertStrategy(action, table);
        expect(strategy).toBeDefined();
        expect(typeof strategy!.execute).toBe("function");
      });
    }
  }

  it("returns undefined for unregistered action:table", () => {
    expect(getRevertStrategy("UPDATE", "unknown_table")).toBeUndefined();
    expect(getRevertStrategy("TRUNCATE", "workers")).toBeUndefined();
  });
});

describe("createRevertContext", () => {
  it("parses pipe-delimited old_data and new_data", () => {
    const log: AuditLog = {
      id: 1,
      action_type: "UPDATE",
      entity_table: "workers",
      record_id: 5,
      old_data: "name=Ahmet|type=GUNLUK|wage=1500|is_active=1",
      new_data: "name=Ahmet|type=ORTAK|wage=2000|is_active=1",
      created_at: "2026-06-21 10:00:00",
    };

    const ctx = createRevertContext(log);
    expect(ctx.oldData).toEqual({
      name: "Ahmet",
      type: "GUNLUK",
      wage: "1500",
      is_active: "1",
    });
    expect(ctx.newData).toEqual({
      name: "Ahmet",
      type: "ORTAK",
      wage: "2000",
      is_active: "1",
    });
  });

  it("handles null old_data for INSERT logs", () => {
    const log: AuditLog = {
      id: 2,
      action_type: "INSERT",
      entity_table: "attendance",
      record_id: 10,
      old_data: null,
      new_data: "worker_id=3|date=2026-06-20|status=FULL",
      created_at: "2026-06-21 10:00:00",
    };

    const ctx = createRevertContext(log);
    expect(ctx.oldData).toBeNull();
    expect(ctx.newData).toEqual({
      worker_id: "3",
      date: "2026-06-20",
      status: "FULL",
    });
  });

  it("handles null new_data for DELETE logs", () => {
    const log: AuditLog = {
      id: 3,
      action_type: "DELETE",
      entity_table: "payments",
      record_id: 7,
      old_data: "worker_id=2|amount=500|date=2026-06-15|description=",
      new_data: null,
      created_at: "2026-06-21 10:00:00",
    };

    const ctx = createRevertContext(log);
    expect(ctx.oldData).toEqual({
      worker_id: "2",
      amount: "500",
      date: "2026-06-15",
      description: "",
    });
    expect(ctx.newData).toBeNull();
  });

  it("handles daily_metrics trigger format (production_amount, total_earned, etc)", () => {
    const log: AuditLog = {
      id: 4,
      action_type: "UPDATE",
      entity_table: "daily_metrics",
      record_id: 15,
      old_data:
        "date=2026-06-20|production_amount=100|total_earned=2500|extra_expenses=200|is_holiday=0",
      new_data:
        "date=2026-06-20|production_amount=120|total_earned=3000|extra_expenses=150|is_holiday=0",
      created_at: "2026-06-21 10:00:00",
    };

    const ctx = createRevertContext(log);
    expect(ctx.oldData).toEqual({
      date: "2026-06-20",
      production_amount: "100",
      total_earned: "2500",
      extra_expenses: "200",
      is_holiday: "0",
    });
    expect(ctx.newData).toEqual({
      date: "2026-06-20",
      production_amount: "120",
      total_earned: "3000",
      extra_expenses: "150",
      is_holiday: "0",
    });
  });

  it("handles attendance trigger format (worker_id, date, status)", () => {
    const log: AuditLog = {
      id: 5,
      action_type: "UPDATE",
      entity_table: "attendance",
      record_id: 20,
      old_data: "worker_id=1|date=2026-06-20|status=FULL",
      new_data: "worker_id=1|date=2026-06-20|status=HALF",
      created_at: "2026-06-21 10:00:00",
    };

    const ctx = createRevertContext(log);
    expect(ctx.oldData).toEqual({
      worker_id: "1",
      date: "2026-06-20",
      status: "FULL",
    });
    expect(ctx.newData).toEqual({
      worker_id: "1",
      date: "2026-06-20",
      status: "HALF",
    });
  });

  it("handles payments trigger without worker_name", () => {
    const log: AuditLog = {
      id: 6,
      action_type: "INSERT",
      entity_table: "payments",
      record_id: 30,
      old_data: null,
      new_data: "worker_id=2|amount=750|date=2026-06-18|description=avans",
      created_at: "2026-06-21 10:00:00",
    };

    const ctx = createRevertContext(log);
    expect(ctx.newData).toEqual({
      worker_id: "2",
      amount: "750",
      date: "2026-06-18",
      description: "avans",
    });
    expect(ctx.newData!.worker_name).toBeUndefined();
  });

  it("handles workers delete trigger format", () => {
    const log: AuditLog = {
      id: 7,
      action_type: "DELETE",
      entity_table: "workers",
      record_id: 3,
      old_data: "name=Ali|type=ORTAK|wage=0|is_active=1",
      new_data: null,
      created_at: "2026-06-21 10:00:00",
    };

    const ctx = createRevertContext(log);
    expect(ctx.oldData).toEqual({
      name: "Ali",
      type: "ORTAK",
      wage: "0",
      is_active: "1",
    });
  });
});
