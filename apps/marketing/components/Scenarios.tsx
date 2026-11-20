import { SCENARIOS } from "../lib/copy";
import { sandboxUrl, scenarioUrl } from "../lib/sandbox";
export default function Scenarios() {
  return <div className="scenarios">{SCENARIOS.map((s) => {
    const href = scenarioUrl(sandboxUrl, s.id);
    return <article key={s.id}><span className="tag">{s.tag}</span><h3>{s.title}</h3><p>{s.body}</p>{href ? <p><a className="text-link" href={href} rel="noopener noreferrer">Open this scenario ↗</a></p> : null}</article>;
  })}</div>;
}
