import { EventEmitter } from 'node:events';
/**
 * Minimum gap between downstream transition notifications (`change`, relayed by
 * the host over the WebSocket). The harness buses publish events on the
 * streaming critical path — during one turn of a long conversation they arrive
 * many times per second, and a keyword flip (`working`/`think` alternating
 * inside stream chunks) would flood the bridge for a pet animation. A
 * leading-edge pass keeps reactions instant; the trailing timer guarantees the
 * final settled state is never swallowed.
 */
const STATE_THROTTLE_MS = 250;
/**
 * Transition detectors in priority order — the first matching pattern decides
 * the state. The keywords are the old ones; only the mechanics changed:
 * precompiled, case-insensitive (no payload-wide lowercase copy is taken), and
 * applied to a handful of identity strings instead of the whole payload.
 */
const DETECTORS = [
    ['error', /(?:error|failed|exception)/i],
    ['celebrate', /(?:success|complete|finished|celebrate)/i],
    ['working', /(?:tool|working|command|running|coding)/i],
    ['think', /(?:think|reason|infer|loading)/i],
    ['idle', /(?:idle|reset|waiting)/i],
];
/** Fields that carry an event's identity or classification. */
const FACT_FIELDS = ['type', 'event', 'kind', 'name', 'status', 'state', 'action', 'phase'];
/** Objects whose one nested level is also scanned for fact fields. */
const PAYLOAD_WRAPPERS = ['payload', 'data', 'details', 'message', 'body', 'info'];
/**
 * Candidate budget. Detection reads a few short identity strings per event;
 * the caps only bound text that a malformed event managed to put into a fact
 * field, and the fallback below keeps a worst case finite.
 */
const MAX_CANDIDATES = 64;
const MAX_CANDIDATE_CHARS = 512;
/** Worst-case cap for the generic fallback scan. */
const FALLBACK_SLICE_CHARS = 4_000;

/** Collect identity strings from structured fields only — no serialization. */
function collectCandidates(value, list) {
    if (typeof value === 'string') {
        if (value !== '' && list.length < MAX_CANDIDATES)
            list.push(value.length > MAX_CANDIDATE_CHARS ? value.slice(0, MAX_CANDIDATE_CHARS) : value);
        return list;
    }
    if (value === null || typeof value !== 'object')
        return list;
    for (const field of FACT_FIELDS) {
        const text = value[field];
        if (typeof text === 'string')
            collectCandidates(text, list);
        if (list.length >= MAX_CANDIDATES)
            return list;
    }
    for (const key of PAYLOAD_WRAPPERS) {
        const nested = value[key];
        if (nested === null || typeof nested !== 'object')
            continue;
        for (const field of FACT_FIELDS) {
            const text = nested[field];
            if (typeof text === 'string')
                collectCandidates(text, list);
            if (list.length >= MAX_CANDIDATES)
                return list;
        }
    }
    return list;
}

/** First detector in priority order that matches any candidate decides. */
function classify(candidates) {
    for (const [state, pattern] of DETECTORS)
        for (const candidate of candidates)
            if (pattern.test(candidate))
                return state;
    return undefined;
}

/** Keeps raw Harness event names isolated from the desktop transport. */
export class AgentStateResolver extends EventEmitter {
    #state = 'idle';
    /** Timestamp of the last transition actually notified downstream. */
    #lastEmit = 0;
    /** Latest state that fell inside the throttle window, not yet emitted. */
    #pending;
    /** Timer backing `pending`; one scheduled trailing emission suffices. */
    #pendingTimer;
    get state() { return this.#state; }
    set(next) {
        if (next === this.#state)
            return;
        this.#state = next;
        const elapsed = Date.now() - this.#lastEmit;
        if (elapsed >= STATE_THROTTLE_MS) {
            // Outside the quiet window: notify now. No trailing emission can be
            // outstanding here — its timer would have fired once the window did.
            this.#pending = undefined;
            this.#lastEmit = Date.now();
            this.emit('change', next);
            return;
        }
        this.#pending = next;
        if (this.#pendingTimer === undefined) {
            this.#pendingTimer = setTimeout(() => {
                this.#pendingTimer = undefined;
                this.#lastEmit = Date.now();
                const emitted = this.#pending;
                this.#pending = undefined;
                this.emit('change', emitted);
            }, STATE_THROTTLE_MS - elapsed);
        }
    }
    consume(event) {
        // `ctx.on` handlers receive the bus arguments as one array; keep the shape
        // flexible while reading identity fields structurally, which never
        // serializes and never grows with the session.
        const parts = Array.isArray(event) ? event : [event];
        const candidates = collectCandidates(parts, []);
        let next = classify(candidates);
        if (next === undefined) {
            // Nothing in the identity fields matched: one bounded scan over a
            // serialization, instead of a full-payload string on every event.
            next = classify([JSON.stringify(event).slice(0, FALLBACK_SLICE_CHARS)]);
        }
        if (next !== undefined)
            this.set(next);
    }
}
