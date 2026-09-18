/**
 * Building one `Memory` from a staged candidate and its evidence.
 *
 * The memory object is a composition of faces, and each face has exactly one
 * owner here: identity is derived from content, epistemic from evidence,
 * salience from the signal, origin from the observation, temporal from
 * observation time, and the rest start empty. Nothing is optional and nothing
 * is guessed — a face with no information gets its empty value, never a
 * plausible-looking default that would later read as data.
 *
 * `confidence != importance`: confidence comes from evidence aggregation,
 * importance from the signal's rule strength and the source class. They are
 * computed on separate lines from separate inputs, and neither can influence
 * the other.
 *
 * @module @deepseek-ai/dsh-memory/src/memory/factory
 */

import { computeConfidence, countIndependentEvidence, semanticKeyOf } from '../evidence/independence.ts'
import type {
  Evidence,
  Memory,
  MemoryKind,
  StagingCandidate,
} from '../types.ts'
import { contentHash } from '../repository.ts'

/** Generator identity stamped on every memory this package writes. */
export const GENERATOR_NAME = 'dsh-bio-memory'

/** Version stamped on generated memories; bump when the shape changes. */
export const GENERATOR_VERSION = '0.1.6-alpha.1'

/** Inputs for one memory build. */
export interface BuildMemoryInput {
  /** Id allocated by the repository. */
  id: string
  /** The staged candidate. */
  candidate: StagingCandidate
  /** Evidence supporting it. */
  evidence: Evidence[]
  /** Tier the record is being written to. */
  kind: MemoryKind
  /** Importance in `[0, 1]`, independent of confidence. */
  importance: number
  /** Current time (ms), used for bookkeeping fields. */
  now: number
}

/**
 * Build one memory record.
 * @param input - The build inputs.
 * @returns The memory, ready to persist.
 */
export function buildMemory(input: BuildMemoryInput): Memory {
  const { candidate, evidence, kind, importance, now } = input
  const semantic = candidate.semanticKey === null
    ? null
    : {
      subject: candidate.semanticKey.subject,
      predicate: candidate.semanticKey.predicate,
      object: objectFromKey(candidate),
    }
  return {
    identity: {
      id: input.id,
      version: 1,
      contentHash: contentHash(candidate.content),
      semanticKey: candidate.semanticKey,
    },
    content: {
      raw: candidate.content,
      kind,
      semantic,
      language: detectLanguage(candidate.content),
    },
    epistemic: {
      status: candidate.epistemic,
      confidence: computeConfidence(evidence),
      evidence,
      contradictions: [],
      independentEvidenceCount: countIndependentEvidence(evidence),
    },
    salience: {
      importance,
      usageCount: 0,
      userMarked: false,
      pinned: false,
    },
    origin: {
      observations: [candidate.rawObservationId],
      derivedFrom: [],
      sessions: [candidate.sessionId],
      generators: [{ name: GENERATOR_NAME, version: GENERATOR_VERSION }],
    },
    temporal: {
      validFrom: candidate.observedAt,
      validTo: null,
      observedAt: candidate.observedAt,
      expiresAt: null,
    },
    relations: {
      supports: [],
      contradicts: [],
      supersedes: [],
      supersededBy: [],
    },
    retrieval: {
      accessCount: 0,
      lastAccessAt: 0,
      recallSuccessRate: 0,
    },
    lifecycle: {
      state: 'active',
      forgetScore: 0,
      forgetScoreUpdatedAt: now,
    },
    scope: candidate.scope,
    governance: {
      tombstones: [],
      approvals: [],
      auditRefs: [],
    },
  }
}

/**
 * Recover the object half of a candidate's triple.
 *
 * The staging candidate carries only the normalized key, so the object is
 * reconstructed from it. When no triple was extracted the key is `null` and
 * this is never reached.
 * @param candidate - The staged candidate.
 * @returns The object value.
 */
function objectFromKey(candidate: StagingCandidate): string {
  return candidate.semanticKey?.normalizedObject ?? candidate.content
}

/**
 * Best-effort language detection from the content's script.
 *
 * Deliberately coarse: the field exists so retrieval can prefer same-language
 * memories, not so it can be linguistically correct. Anything that is not
 * predominantly CJK is recorded as `en`, which is the harness's working
 * language rather than a claim about the text.
 * @param content - The raw content.
 * @returns A BCP-47-ish tag.
 */
export function detectLanguage(content: string): string {
  let cjk = 0
  let latin = 0
  for (const char of content) {
    const code = char.codePointAt(0)
    if (code === undefined) continue
    if (code >= 0x4e00 && code <= 0x9fff) cjk += 1
    else if ((code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a)) latin += 1
  }
  // Ties go to Chinese: the content carries CJK at all, and the alternative
  // would classify every short Chinese sentence mentioning an ASCII
  // identifier (the common case here) as English.
  return cjk > 0 && cjk >= latin ? 'zh' : 'en'
}

/**
 * Build the normalized fact key for a candidate's triple.
 * @param subject - Subject.
 * @param predicate - Predicate.
 * @param object - Object value.
 * @returns The normalized key.
 */
export function keyOf(subject: string, predicate: string, object: unknown): ReturnType<typeof semanticKeyOf> {
  return semanticKeyOf(subject, predicate, object)
}

/** How much each source class contributes to a memory's importance. */
const SOURCE_IMPORTANCE: Record<StagingCandidate['sourceType'], number> = {
  explicit_user: 0.9,
  tool_verified: 0.7,
  agent_inference: 0.4,
  external: 0.5,
}

/**
 * Derive importance from the capture signal, independently of confidence.
 *
 * Importance answers "how much does this matter", confidence answers "how sure
 * are we". A user's explicit standing instruction is highly important and
 * highly certain; a tool-verified file count is highly certain and hardly
 * important. Mixing the two would make one of them meaningless, so this reads
 * only the signal's strength and the source class.
 * @param candidate - The staged candidate.
 * @returns Importance in `[0, 1]`.
 */
export function deriveImportance(candidate: StagingCandidate): number {
  const source = SOURCE_IMPORTANCE[candidate.sourceType]
  return Math.max(0, Math.min(1, 0.5 * candidate.strength + 0.5 * source))
}
