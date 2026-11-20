import { STATUS, type StatusRow } from "../lib/copy";

function Column({ label, tone, rows, detail }: { label: string; tone: string; rows: StatusRow[]; detail: boolean }) {
  return (
    <section className={`ledger-col ${tone}`}>
      <h3><span className="ledger-dot" aria-hidden="true" />{label}</h3>
      <ul>{rows.map((r) => (
        <li key={r.item}>
          <b>{r.item}</b>
          {detail && <p>{r.note}</p>}
          {detail && <a className="ledger-where" href={r.href} rel="noopener noreferrer">{r.where} ↗</a>}
        </li>
      ))}</ul>
    </section>
  );
}

// What exists, what is being built and what is only planned. The home page shows the short form; /status the full one.
export default function StatusLedger({ detail = false }: { detail?: boolean }) {
  return (
    <div className="ledger">
      <Column label="Exists today" tone="exists" rows={STATUS.exists} detail={detail} />
      <Column label="Being built" tone="building" rows={STATUS.building} detail={detail} />
      <Column label="Planned" tone="planned" rows={STATUS.planned} detail={detail} />
    </div>
  );
}
