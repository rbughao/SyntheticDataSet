/**
 * Audience personas.
 *
 * The same document answers very different questions depending on who is
 * asking. A newcomer wants to know what something *is*; an auditor wants to
 * know who approved it. Generating without a persona produces neutral,
 * encyclopedic pairs — fine for coverage, weak for training a model that has
 * to serve a particular audience.
 *
 * A persona steers both halves of the pair: which questions get asked, and how
 * the answer is pitched.
 */

/**
 * @typedef {object} Persona
 * @property {string} id
 * @property {string} name      Short label, shown on the pair card
 * @property {string} summary   One line, shown in the picker
 * @property {string} role      Who they are
 * @property {string} goal      What they are trying to achieve
 * @property {string} context   Their circumstances and constraints
 * @property {string} expertise What they already know — drives vocabulary
 * @property {string} asks      The shape of questions they tend to ask
 */

export const PRESET_PERSONAS = [
  {
    id: 'newcomer',
    name: 'Newcomer',
    summary: 'First encounter, no background',
    role: 'someone meeting this subject for the first time',
    goal: 'build a working mental model quickly, without being overwhelmed',
    context: 'has no prior exposure, and does not yet know which details matter',
    expertise: 'none — unfamiliar with the jargon and the underlying concepts',
    asks: 'broad orienting questions: what something is, why it exists, how the pieces fit together, what the terms mean',
  },
  {
    id: 'practitioner',
    name: 'Practitioner',
    summary: 'Uses this daily, wants specifics',
    role: 'someone who works with this subject regularly',
    goal: 'get a precise answer to a concrete question and get back to work',
    context: 'already fluent in the basics; interruptions are costly',
    expertise: 'solid working knowledge — does not need concepts re-explained',
    asks: 'specific operational questions: exact values, correct procedure, what to do in a particular situation',
  },
  {
    id: 'expert',
    name: 'Expert',
    summary: 'Deep knowledge, probes edge cases',
    role: 'a specialist with deep familiarity with the subject',
    goal: 'understand the boundaries, exceptions, and reasoning behind decisions',
    context: 'knows the happy path already and is interested in where it breaks',
    expertise: 'high — comfortable with nuance, precision, and technical detail',
    asks: 'edge cases, trade-offs, why one approach was chosen over another, what happens under unusual conditions',
  },
  {
    id: 'decision-maker',
    name: 'Decision maker',
    summary: 'Cares about outcomes, cost and risk',
    role: 'someone accountable for a decision but not for the implementation',
    goal: 'judge impact, cost, risk and timing well enough to decide',
    context: 'limited time, no appetite for mechanism — needs the consequence, not the method',
    expertise: 'strong on business context, light on technical detail',
    asks: 'what this costs, what it risks, what it changes, how long it takes, what happens if we do nothing',
  },
  {
    id: 'support',
    name: 'Support agent',
    summary: 'Resolving someone else’s problem, fast',
    role: 'a support agent handling a live customer issue',
    goal: 'identify the cause and give the customer a correct answer immediately',
    context: 'under time pressure, speaking to someone who is already frustrated',
    expertise: 'knows the product broadly; needs the specific resolution steps',
    asks: 'symptom-first questions: what causes this, how do I fix it, what do I tell the customer, when do I escalate',
  },
  {
    id: 'developer',
    name: 'Developer',
    summary: 'Integrating, debugging, reading errors',
    role: 'an engineer implementing against this subject',
    goal: 'get something working correctly, and understand failures when it does not',
    context: 'writing code right now, with an error message or a spec in front of them',
    expertise: 'technically fluent, but new to this particular system',
    asks: 'how to call it, what the parameters mean, what this error means, what the expected shape of the response is',
  },
  {
    id: 'auditor',
    name: 'Auditor',
    summary: 'Evidence, obligations, exceptions',
    role: 'a compliance or audit reviewer',
    goal: 'establish what is required, what was actually done, and where the gaps are',
    context: 'must be able to evidence every conclusion; ambiguity is a finding',
    expertise: 'strong on process and obligation, neutral on the subject matter',
    asks: 'what the rule is, who is responsible, what the exceptions are, how compliance is demonstrated, what the retention period is',
  },
  {
    id: 'skeptic',
    name: 'Skeptic',
    summary: 'Challenges claims, looks for gaps',
    role: 'a critical reader who does not take claims at face value',
    goal: 'test whether the material holds up and find what it leaves out',
    context: 'assumes the document presents its best case and looks for the rest',
    expertise: 'informed enough to spot vagueness and unsupported assertions',
    asks: 'what the evidence is, what the limitations are, what is deliberately not said, under what conditions this fails',
  },
]

export const PERSONA_BY_ID = Object.fromEntries(PRESET_PERSONAS.map((p) => [p.id, p]))

/** Marker id for the user's own free-text persona. */
export const CUSTOM_PERSONA_ID = 'custom'

/**
 * Turn the persona settings into the list actually used for a run.
 *
 * Returns an empty array when no persona is chosen — which keeps the original
 * neutral behaviour rather than silently imposing a default point of view.
 *
 * @param {object} settings  { personaIds: string[], customPersona: string }
 * @returns {Persona[]}
 */
export function resolvePersonas(settings) {
  const ids = settings?.personaIds || []
  const out = []

  for (const id of ids) {
    if (id === CUSTOM_PERSONA_ID) continue
    const preset = PERSONA_BY_ID[id]
    if (preset) out.push(preset)
  }

  const custom = (settings?.customPersona || '').trim()
  if (ids.includes(CUSTOM_PERSONA_ID) && custom) {
    out.push({
      id: CUSTOM_PERSONA_ID,
      name: 'Custom',
      summary: custom.slice(0, 60),
      // A free-text persona goes in whole: the user described the point of
      // view in their own words, and splitting it into fields would only
      // guess at which sentence meant what.
      freeText: custom,
    })
  }

  return out
}

/**
 * Render a persona as the prompt fragment describing the point of view.
 * Kept here so the prompt wording lives next to the persona definitions.
 */
export function describePersona(persona) {
  if (persona.freeText) {
    return `PERSONA — the person asking and being answered:\n${persona.freeText}`
  }
  return [
    `PERSONA — the person asking and being answered: ${persona.name}`,
    `Who they are: ${persona.role}.`,
    `What they want: ${persona.goal}.`,
    `Their situation: ${persona.context}.`,
    `What they already know: ${persona.expertise}.`,
    `The kind of thing they ask about: ${persona.asks}.`,
  ].join('\n')
}
