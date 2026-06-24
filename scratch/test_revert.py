import os
import sqlite3
import re

# 1. Parse log data function replicated from JS
def parse_log_data(data):
    if not data:
        return None
    trimmed = data.strip()
    
    if trimmed.startswith('{'):
        import json
        try:
            return json.loads(trimmed)
        except Exception:
            pass
            
    if '=' in trimmed:
        result = {}
        for part in trimmed.split('|'):
            eq_idx = part.find('=')
            if eq_idx > 0:
                result[part[:eq_idx].strip()] = part[eq_idx+1:].strip()
        if result:
            return result
            
    # Simple plain text fallback matches
    worker_match = re.match(r'^Worker:\s*(.+)', trimmed, re.IGNORECASE)
    if worker_match:
        return {'name': worker_match.group(1)}
        
    return {'_raw': trimmed}

# 2. Database path
db_path = os.path.expanduser('~/Library/Application Support/com.mby.istakip/is_takip_v3.db')
print(f"Opening database: {db_path}")

try:
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    # Get latest audit log
    cursor.execute("SELECT id, action_type, entity_table, record_id, old_data, new_data, created_at FROM audit_logs ORDER BY id DESC LIMIT 1;")
    row = cursor.fetchone()
    
    if not row:
        print("No audit logs found in the database!")
        conn.close()
        exit(0)
        
    log_id, action_type, entity_table, record_id, old_data, new_data, created_at = row
    print("\n--- LATEST AUDIT LOG RECORD ---")
    print(f"Log ID: {log_id}")
    print(f"Action: {action_type}")
    print(f"Table: {entity_table}")
    print(f"Record ID: {record_id}")
    print(f"Old Data: {old_data}")
    print(f"New Data: {new_data}")
    print(f"Created At: {created_at}")
    
    old_parsed = parse_log_data(old_data)
    new_parsed = parse_log_data(new_data)
    
    print("\n--- PARSED STATES ---")
    print(f"Parsed Old: {old_parsed}")
    print(f"Parsed New: {new_parsed}")
    
    # 3. Perform Revert and Commit
    print("\n--- EXECUTING REVERT AND COMMITING ---")
    conn.execute("BEGIN TRANSACTION;")
    
    if action_type == 'UPDATE':
        if entity_table == 'daily_metrics':
            if old_parsed and 'date' in old_parsed:
                p_amt = int(old_parsed.get('production') or old_parsed.get('production_amount') or 0)
                t_earned = float(old_parsed.get('earned') or old_parsed.get('total_earned') or 0.0)
                e_exp = float(old_parsed.get('expenses') or old_parsed.get('extra_expenses') or 0.0)
                is_hol = int(old_parsed.get('holiday') or old_parsed.get('is_holiday') or 0)
                
                print(f"Executing daily_metrics UPDATE:")
                print(f"  production_amount = {p_amt}")
                print(f"  total_earned = {t_earned}")
                print(f"  extra_expenses = {e_exp}")
                print(f"  is_holiday = {is_hol}")
                print(f"  where id = {record_id}")
                
                cursor.execute(
                    "UPDATE daily_metrics SET production_amount = ?, total_earned = ?, extra_expenses = ?, is_holiday = ? WHERE id = ?;",
                    (p_amt, t_earned, e_exp, is_hol, record_id)
                )
                print(f"  daily_metrics UPDATE rows affected: {cursor.rowcount}")
                
                if 'atts' in old_parsed:
                    atts_str = old_parsed['atts']
                    print(f"Restoring attendance snapshot: {atts_str}")
                    for part in atts_str.split(','):
                        sub_parts = part.strip().split(':')
                        if len(sub_parts) >= 3:
                            w_id, w_name, w_status = sub_parts[0], sub_parts[1], sub_parts[2]
                            if w_status and w_status != 'YOK':
                                print(f"  INSERT OR REPLACE worker {w_id} ({w_name}) status {w_status} on {old_parsed['date']}")
                                cursor.execute(
                                    "INSERT OR REPLACE INTO attendance (worker_id, date, status) VALUES (?, ?, ?);",
                                    (int(w_id), old_parsed['date'], w_status)
                                )
                            else:
                                print(f"  DELETE worker {w_id} ({w_name}) on {old_parsed['date']}")
                                cursor.execute(
                                    "DELETE FROM attendance WHERE worker_id = ? AND date = ?;",
                                    (int(w_id), old_parsed['date'])
                                )
            else:
                print("Error: UPDATE old_data doesn't have date!")
        else:
            print(f"Table {entity_table} simulation not implemented in script, but continuing.")
            
    elif action_type == 'INSERT':
        print(f"Executing INSERT revert (Deleting row {record_id} in {entity_table}):")
        if entity_table == 'daily_metrics' and new_parsed and 'date' in new_parsed:
            print(f"  Deleting associated attendance for date: {new_parsed['date']}")
            cursor.execute("DELETE FROM attendance WHERE date = ?;", (new_parsed['date'],))
            print(f"  deleted attendance rows: {cursor.rowcount}")
            
        cursor.execute(f"DELETE FROM {entity_table} WHERE id = ?;", (record_id,))
        print(f"  deleted row in {entity_table}: {cursor.rowcount}")
        
    elif action_type == 'DELETE':
        print("Executing DELETE revert (Re-inserting deleted row)...")
        if entity_table == 'daily_metrics' and old_parsed and 'date' in old_parsed:
            p_amt = int(old_parsed.get('production') or old_parsed.get('production_amount') or 0)
            t_earned = float(old_parsed.get('earned') or old_parsed.get('total_earned') or 0.0)
            e_exp = float(old_parsed.get('expenses') or old_parsed.get('extra_expenses') or 0.0)
            is_hol = int(old_parsed.get('holiday') or old_parsed.get('is_holiday') or 0)
            
            cursor.execute(
                "INSERT INTO daily_metrics (id, date, production_amount, total_earned, extra_expenses, is_holiday) VALUES (?, ?, ?, ?, ?, ?);",
                (record_id, old_parsed['date'], p_amt, t_earned, e_exp, is_hol)
            )
            print(f"  Re-inserted daily_metrics row {record_id}. rows affected: {cursor.rowcount}")
            
    # Delete the audit log itself
    cursor.execute("DELETE FROM audit_logs WHERE id = ?;", (log_id,))
    print(f"Deleted audit log {log_id}. rows affected: {cursor.rowcount}")
    
    conn.commit()
    print("\nRevert committed successfully to the database!")
    conn.close()

except Exception as err:
    print(f"\n[FATAL ERROR IN REVERT]: {err}")
    if 'conn' in locals():
        conn.execute("ROLLBACK;")
        conn.close()
