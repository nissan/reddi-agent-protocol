import { SCENARIOS } from "../lib/copy";
export default function Scenarios() {
  return <div className="scenarios">{SCENARIOS.map((s) => <article key={s.title}><span className="tag">{s.tag}</span><h3>{s.title}</h3><p>{s.body}</p></article>)}</div>;
}
