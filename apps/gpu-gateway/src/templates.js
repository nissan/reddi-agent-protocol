// What each studio desk may ask rtwin1 to run. Anything not described here is refused before it is queued.
// The rgpu runner on rtwin1 checks the job again (defence in depth), but these are the rules that matter.

export const DESKS = ["script", "voice", "video", "stitch"];

const PLAIN_FILE = /^[A-Za-z0-9._-]{1,80}$/;
const TASK_ID = /^t_[A-Za-z0-9_-]{16,40}$/;

// Rough GPU minutes a task holds the card, for the daily cap. CPU kinds (speech, stitch) count 0.
export const GPU_MINUTES = { text: 1, image: 1, video: 7, speech: 0, stitch: 0 };

// Active (queued or running) tasks one desk may hold for one Budget.
export const ACTIVE_PER_BUDGET = { script: 1, voice: 1, video: 5, stitch: 1 };

export class Refused extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function onlyKeys(obj, allowed, what) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) throw new Refused(`${what} must be an object`);
  const extra = Object.keys(obj).filter((k) => !allowed.includes(k));
  if (extra.length) throw new Refused(`${what}: not allowed: ${extra.sort().join(", ")}`);
}

function text(value, max, what) {
  if (typeof value !== "string" || !value.trim()) throw new Refused(`${what} must be non-empty text`);
  if (value.length > max) throw new Refused(`${what} is limited to ${max} characters`);
  return value;
}

function int(value, low, high, what, fallback) {
  const v = value ?? fallback;
  if (!Number.isInteger(v) || v < low || v > high) throw new Refused(`${what} must be a whole number from ${low} to ${high}`);
  return v;
}

/** A reference to an earlier task's output file: { task, file }. */
export function taskRef(value, suffix, what) {
  onlyKeys(value, ["task", "file"], what);
  if (typeof value.task !== "string" || !TASK_ID.test(value.task)) throw new Refused(`${what}.task must be a task id`);
  if (typeof value.file !== "string" || !PLAIN_FILE.test(value.file) || !value.file.endsWith(suffix)) {
    throw new Refused(`${what}.file must be an output file name ending in ${suffix}`);
  }
  return { task: value.task, file: value.file };
}

/**
 * Checks a desk's job and returns { job, refs }: the job as rgpu will get it (refs still by task id) and
 * the earlier tasks it reads. Models and sizes are fixed here, not chosen by the caller.
 */
export function checkJob(desk, job, env = {}) {
  onlyKeys(job, ["kind", "prompt", "params", "image_from"], "job");
  const params = job.params ?? {};
  switch (desk) {
    case "script": {
      if (job.kind !== "text") throw new Refused("the script desk runs text jobs only");
      onlyKeys(params, ["system", "num_predict"], "params");
      const out = { think: false, num_predict: int(params.num_predict, 64, 1500, "num_predict", 800) };
      if (params.system !== undefined) out.system = text(params.system, 2000, "system");
      return { job: { kind: "text", model: env.SCRIPT_MODEL || "qwen3.8:27b", prompt: text(job.prompt, 4000, "prompt"), params: out }, refs: [] };
    }
    case "voice": {
      if (job.kind !== "speech") throw new Refused("the voice desk runs speech jobs only");
      onlyKeys(params, ["voice", "speed"], "params");
      const out = {};
      if (params.voice !== undefined) {
        if (typeof params.voice !== "string" || !/^[a-z]{2}_[a-z]{2,16}$/.test(params.voice)) throw new Refused("voice must be a voice name");
        out.voice = params.voice;
      }
      if (params.speed !== undefined) {
        if (typeof params.speed !== "number" || params.speed < 0.5 || params.speed > 2) throw new Refused("speed must be from 0.5 to 2");
        out.speed = params.speed;
      }
      return { job: { kind: "speech", prompt: text(job.prompt, 2000, "prompt"), params: out }, refs: [] };
    }
    case "video": {
      if (job.kind === "image") {
        if (job.image_from !== undefined) throw new Refused("an image job takes no image_from");
        onlyKeys(params, ["seed"], "params");
        const out = { width: 832, height: 480 };
        if (params.seed !== undefined) out.seed = int(params.seed, 0, 2 ** 31 - 1, "seed");
        return { job: { kind: "image", model: "z-image-turbo", prompt: text(job.prompt, 1500, "prompt"), params: out }, refs: [] };
      }
      if (job.kind === "video") {
        const ref = taskRef(job.image_from, ".png", "image_from");
        onlyKeys(params, ["seed", "frames"], "params");
        // 81 frames at 16 fps is the model's 5 s clip; shorter is allowed, longer is not.
        const out = { frames: int(params.frames, 17, 81, "frames", 81) };
        if (params.seed !== undefined) out.seed = int(params.seed, 0, 2 ** 31 - 1, "seed");
        return { job: { kind: "video", model: "wan22-i2v-14b", prompt: text(job.prompt, 1500, "prompt"), params: out, image_from: ref }, refs: [ref] };
      }
      throw new Refused("the video desk runs image and video jobs only");
    }
    case "stitch": {
      if (job.kind !== "stitch") throw new Refused("the stitch desk runs stitch jobs only");
      onlyKeys(params, ["clips", "audio"], "params");
      if (!Array.isArray(params.clips) || params.clips.length < 1 || params.clips.length > 6) throw new Refused("clips must list 1 to 6 clips");
      const clips = params.clips.map((c, i) => taskRef(c, ".mp4", `clips[${i}]`));
      const audio = params.audio === undefined ? undefined : taskRef(params.audio, ".wav", "audio");
      const out = { clips, width: 832, height: 480, fps: 16, ...(audio ? { audio } : {}) };
      return { job: { kind: "stitch", prompt: text(job.prompt ?? "final cut", 200, "prompt"), params: out }, refs: audio ? [...clips, audio] : clips };
    }
    default:
      throw new Refused("unknown desk", 403);
  }
}

/** The job with task refs replaced by rgpu job ids, for the runner. */
export function resolveRefs(job, rgpuJobOf) {
  const swap = (ref) => ({ job: rgpuJobOf(ref.task), file: ref.file });
  const out = structuredClone(job);
  if (out.image_from) out.image_from = swap(out.image_from);
  if (out.kind === "stitch") {
    out.params.clips = out.params.clips.map(swap);
    if (out.params.audio) out.params.audio = swap(out.params.audio);
  }
  return out;
}

export { PLAIN_FILE, TASK_ID };
