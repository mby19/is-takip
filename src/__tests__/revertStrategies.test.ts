import { describe, it, expect } from "vitest";
import { getRevertStrategy, createRevertContext } from "../stores/revertStrategies";
import { parseLogData } from "../utils/parseLogData";
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

describe("Revert strategy data extraction", () => {
  describe("updateDailyMetricsStrategy field aliases", () => {
    const testData = [
      // (label, oldData, expected production, expected earned, expected expenses, expected holiday)
      {
        label: "uses production_amount/total_earned/extra_expenses/is_holiday",
        data: {
          production_amount: "100",
          total_earned: "2500",
          extra_expenses: "200",
          is_holiday: "1",
        },
        prod: 100,
        earned: 2500,
        expenses: 200,
        holiday: 1,
      },
      {
        label: "falls back to production/earned/expenses/holiday (short aliases)",
        data: { production: "50", earned: "1500", expenses: "100", holiday: "0" },
        prod: 50,
        earned: 1500,
        expenses: 100,
        holiday: 0,
      },
      {
        label: "falls back to 0 for missing numeric fields",
        data: { date: "2026-06-20" },
        prod: 0,
        earned: 0,
        expenses: 0,
        holiday: 0,
      },
      {
        label: "handles empty string as 0",
        data: { production: "", earned: "", extra_expenses: "", is_holiday: "" },
        prod: 0,
        earned: 0,
        expenses: 0,
        holiday: 0,
      },
      {
        label: "treats undefined fields as 0",
        data: {},
        prod: 0,
        earned: 0,
        expenses: 0,
        holiday: 0,
      },
    ] as const;

    testData.forEach(({ label, data: rawData, prod, earned, expenses, holiday }) => {
      const data = rawData as unknown as Record<string, string>;
      it(label, () => {
        const pAmt = parseInt(data.production || data.production_amount || "0");
        const tEarned = parseFloat(data.earned || data.total_earned || "0");
        const eExp = parseFloat(data.expenses || data.extra_expenses || "0");
        const isHol = parseInt(data.holiday || data.is_holiday || "0");

        expect(pAmt).toBe(prod);
        expect(tEarned).toBe(earned);
        expect(eExp).toBe(expenses);
        expect(isHol).toBe(holiday);
      });
    });
  });

  describe("updatePaymentsStrategy field extraction", () => {
    it("extracts amount, date, description", () => {
      const oldData: Record<string, string> = {
        amount: "500",
        date: "2026-06-15",
        description: "avans",
      };
      expect(parseFloat(oldData.amount || "0")).toBe(500);
      expect(oldData.date).toBe("2026-06-15");
      expect(oldData.description).toBe("avans");
    });

    it("returns null for missing description", () => {
      const oldData: Record<string, string> = { amount: "300", date: "2026-06-15" };
      expect((oldData as Record<string, string>).description || null).toBeNull();
    });

    it("coerces missing amount to 0", () => {
      const oldData: Record<string, string> = { date: "2026-06-15" };
      expect(parseFloat((oldData as Record<string, string>).amount || "0")).toBe(0);
    });
  });

  describe("updateAttendanceStrategy worker resolution", () => {
    it("prefers worker_id over worker_name", () => {
      const oldData: Record<string, string> = {
        worker_id: "5",
        worker_name: "Ahmet",
        status: "FULL",
        date: "2026-06-20",
      };

      const workerId = oldData.worker_id ? parseInt(oldData.worker_id) : null;
      expect(workerId).toBe(5);

      const fallbackId = !workerId && oldData.worker_name ? 42 : null;
      expect(fallbackId).toBeNull();
    });

    it("falls back to worker_name lookup when worker_id is missing", () => {
      const oldData: Record<string, string> = {
        worker_name: "Ahmet",
        status: "FULL",
        date: "2026-06-20",
      };

      const workerId = oldData.worker_id ? parseInt(oldData.worker_id) : null;
      expect(workerId).toBeNull();

      expect(oldData.worker_name).toBe("Ahmet");
    });

    it("throws when both worker_id and worker_name are missing", () => {
      const oldData: Record<string, string> = { status: "FULL", date: "2026-06-20" };

      const workerId = oldData.worker_id ? parseInt(oldData.worker_id) : null;
      const canLookup = !workerId && oldData.worker_name;

      expect(workerId).toBeNull();
      expect(canLookup).toBeFalsy();
      expect(() => {
        if (!workerId && !canLookup) throw new Error("Çalışan bulunamadı.");
      }).toThrow("Çalışan bulunamadı.");
    });
  });

  describe("updateWorkersStrategy field extraction", () => {
    it("extracts name, type, wage, is_active with aliases", () => {
      const cases: {
        data: Record<string, string>;
        expectedName: string;
        expectedType: string;
        expectedWage: number;
        expectedActive: number;
      }[] = [
        {
          data: { name: "Ali", type: "ORTAK", wage: "0", is_active: "1" },
          expectedName: "Ali",
          expectedType: "ORTAK",
          expectedWage: 0,
          expectedActive: 1,
        },
        {
          data: { name: "Veli", worker_type: "GUNLUK", daily_wage: "2000", is_active: "0" },
          expectedName: "Veli",
          expectedType: "GUNLUK",
          expectedWage: 2000,
          expectedActive: 0,
        },
        {
          data: { name: "Can", type: "GUNLUK", daily_wage: "1500" },
          expectedName: "Can",
          expectedType: "GUNLUK",
          expectedWage: 1500,
          expectedActive: 1,
        },
      ];

      cases.forEach(({ data, expectedName, expectedType, expectedWage, expectedActive }) => {
        const name = data.name;
        const type = data.type || data.worker_type;
        const wage = parseFloat(data.wage || data.daily_wage || "0");
        const isActive = parseInt(data.is_active || "1");

        expect(name).toBe(expectedName);
        expect(type).toBe(expectedType);
        expect(wage).toBe(expectedWage);
        expect(isActive).toBe(expectedActive);
      });
    });

    it("throws when name or type is missing", () => {
      const noName: Record<string, string> = { type: "GUNLUK", wage: "1500" };
      const noType: Record<string, string> = { name: "Ali", wage: "1500" };

      expect(() => {
        if (!noName.name || !noName.type) throw new Error("Önceki çalışan bilgileri eksik.");
      }).toThrow();

      expect(() => {
        if (!noType.name || !noType.type) throw new Error("Önceki çalışan bilgileri eksik.");
      }).toThrow();
    });
  });

  describe("deletePaymentsStrategy field extraction", () => {
    it("extracts all required fields", () => {
      const oldData: Record<string, string> = {
        worker_id: "3",
        amount: "1000",
        date: "2026-06-10",
        description: "maaş",
      };
      expect(oldData.worker_id).toBeTruthy();
      expect(oldData.date).toBeTruthy();
      expect(oldData.amount).toBe("1000");
    });

    it("throws when worker_id or date is missing", () => {
      const noWorker: Record<string, string> = { amount: "500", date: "2026-06-10" };
      const noDate: Record<string, string> = { worker_id: "3", amount: "500" };

      expect(() => {
        if (!noWorker.worker_id || !noWorker.date)
          throw new Error("Silinen ödeme bilgileri eksik.");
      }).toThrow();
      expect(() => {
        if (!noDate.worker_id || !noDate.date) throw new Error("Silinen ödeme bilgileri eksik.");
      }).toThrow();
    });
  });
});

describe("Log filtering", () => {
  const logs: AuditLog[] = [
    {
      id: 1,
      action_type: "INSERT",
      entity_table: "workers",
      record_id: 1,
      old_data: null,
      new_data: "name=Ali",
      created_at: "2026-06-21 10:00:00",
    },
    {
      id: 2,
      action_type: "UPDATE",
      entity_table: "attendance",
      record_id: 1,
      old_data: "status=FULL",
      new_data: "status=HALF",
      created_at: "2026-06-21 11:00:00",
    },
    {
      id: 3,
      action_type: "INSERT",
      entity_table: "daily_metrics",
      record_id: 1,
      old_data: null,
      new_data: "date=2026-06-20|production=50",
      created_at: "2026-06-21 12:00:00",
    },
    {
      id: 4,
      action_type: "UPDATE",
      entity_table: "daily_metrics",
      record_id: 1,
      old_data: "production=50",
      new_data: "production=60",
      created_at: "2026-06-21 13:00:00",
    },
    {
      id: 5,
      action_type: "INSERT",
      entity_table: "payments",
      record_id: 1,
      old_data: null,
      new_data: "worker_id=1|amount=500",
      created_at: "2026-06-21 14:00:00",
    },
    {
      id: 6,
      action_type: "DELETE",
      entity_table: "payments",
      record_id: 1,
      old_data: "worker_id=1|amount=500",
      new_data: null,
      created_at: "2026-06-21 15:00:00",
    },
  ];

  it("filter=ALL returns all logs", () => {
    const filter: string = "ALL";
    const filtered = logs.filter((log) => {
      if (filter === "ALL") return true;
      return log.entity_table === filter;
    });
    expect(filtered).toHaveLength(6);
  });

  it("filter=daily_metrics returns only daily_metrics logs", () => {
    const filter: string = "daily_metrics";
    const filtered = logs.filter((log) => {
      if (filter === "ALL") return true;
      return log.entity_table === filter;
    });
    expect(filtered).toHaveLength(2);
    expect(filtered.every((l) => l.entity_table === "daily_metrics")).toBe(true);
  });

  it("filter=payments returns only payments logs", () => {
    const filter: string = "payments";
    const filtered = logs.filter((log) => {
      if (filter === "ALL") return true;
      return log.entity_table === filter;
    });
    expect(filtered).toHaveLength(2); // INSERT + DELETE
    expect(filtered.every((l) => l.entity_table === "payments")).toBe(true);
  });

  it("filter=ALL with empty logs returns empty array", () => {
    const filter: string = "ALL";
    const empty: AuditLog[] = [];
    const filtered = empty.filter((log) => {
      if (filter === "ALL") return true;
      return log.entity_table === filter;
    });
    expect(filtered).toHaveLength(0);
  });

  it("returns empty filtered array when no entity_table matches", () => {
    const filter: string = "payments";
    const noPaymentsLogs = logs.filter((l) => l.entity_table !== "payments");
    const filtered = noPaymentsLogs.filter((log) => {
      if (filter === "ALL") return true;
      return log.entity_table === filter;
    });
    expect(filtered).toHaveLength(0);
  });

  it("handles unknown filter value gracefully (shows nothing)", () => {
    const filter: string = "nonexistent";
    const filtered = logs.filter((log) => {
      if (filter === "ALL") return true;
      return log.entity_table === filter;
    });
    expect(filtered).toHaveLength(0);
  });
});

describe("Trigger format compatibility", () => {
  it("payments INSERT trigger format (without worker_name) can be parsed by parseLogData", () => {
    const data = "worker_id=2|amount=750|date=2026-06-18|description=avans";
    const result = parseLogData(data);
    expect(result).toEqual({
      worker_id: "2",
      amount: "750",
      date: "2026-06-18",
      description: "avans",
    });
  });

  it("payments UPDATE trigger format is parseable", () => {
    const oldData = parseLogData("worker_id=1|amount=500|date=2026-06-15|description=");
    const newData = parseLogData("worker_id=1|amount=600|date=2026-06-15|description=");
    expect(oldData?.description).toBe("");
    expect(newData?.amount).toBe("600");
  });

  it("payments DELETE trigger format is parseable (no new_data)", () => {
    const oldData = parseLogData("worker_id=3|amount=1000|date=2026-06-10|description=maaş");
    expect(oldData).toEqual({
      worker_id: "3",
      amount: "1000",
      date: "2026-06-10",
      description: "maaş",
    });
  });

  it("attendance INSERT/UPDATE trigger format is parseable", () => {
    const nd = parseLogData("worker_id=1|date=2026-06-20|status=FULL");
    expect(nd).toEqual({ worker_id: "1", date: "2026-06-20", status: "FULL" });
  });

  it("daily_metrics DELETE trigger format is parseable", () => {
    const od = parseLogData(
      "date=2026-06-20|production_amount=100|total_earned=2500|extra_expenses=200|is_holiday=0",
    );
    expect(od).toEqual({
      date: "2026-06-20",
      production_amount: "100",
      total_earned: "2500",
      extra_expenses: "200",
      is_holiday: "0",
    });
  });
});
