/**
 * Prompt and reply schema for a conversation turn.
 *
 * One provider call does both jobs: it answers as a conversation partner and
 * reports any mistakes in the user's latest turn. Keeping them in one call
 * halves request count, which matters against a free-tier daily limit.
 */

export const TOPICS = [
  {
    id: 'free-chat',
    label: 'Free chat',
    description: 'An open, friendly conversation about anything the user wants to talk about.',
    role: 'a friendly acquaintance chatting casually',
  },
  {
    id: 'job-interview',
    label: 'Job interview',
    description: 'A job interview. Ask one interview question at a time and react to the answers.',
    role: 'a polite hiring manager interviewing the user',
  },
  {
    id: 'ordering-food',
    label: 'Ordering food',
    description: 'The user is ordering food at a restaurant or cafe.',
    role: 'a server taking the order',
  },
  {
    id: 'small-talk',
    label: 'Small talk',
    description: 'Light small talk: weather, weekend plans, hobbies, work.',
    role: 'a colleague making small talk',
  },
  {
    id: 'travel',
    label: 'Travel',
    description: 'Travel situations: checking in, asking for directions, booking a room.',
    role: 'a hotel or airport staff member, or a helpful local',
  },
  {
    id: 'doctor-visit',
    label: 'Doctor visit',
    description: 'A routine doctor appointment where the user describes a problem.',
    role: 'a calm general practitioner',
  },
  {
    id: 'shopping',
    label: 'Shopping',
    description: 'Shopping in a store: asking about sizes, prices, returns.',
    role: 'a shop assistant',
  },
  {
    id: 'phone-call',
    label: 'Phone call',
    description: 'A phone call to a business: booking, rescheduling, or asking a question.',
    role: 'a receptionist answering the phone',
  },
];

export const DIFFICULTIES = [
  {
    id: 'beginner',
    label: 'Beginner',
    instruction:
      'Use short, simple sentences and common everyday words. One idea per sentence. Speak slowly in style: no idioms, no slang, no long clauses. Keep replies to 1-2 sentences.',
  },
  {
    id: 'intermediate',
    label: 'Intermediate',
    instruction:
      'Use natural everyday English at a normal pace. Some common idioms are fine. Keep replies to 2-3 sentences.',
  },
  {
    id: 'advanced',
    label: 'Advanced',
    instruction:
      'Use rich, natural English including idioms, phrasal verbs and less common vocabulary. Challenge the user with follow-up questions. Keep replies to 2-4 sentences.',
  },
];

export const DEFAULT_TOPIC = 'free-chat';
export const DEFAULT_DIFFICULTY = 'intermediate';

export const MISTAKE_TYPES = [
  'grammar',
  'verb-tense',
  'article',
  'preposition',
  'plural',
  'word-order',
  'word-choice',
  'phrasing',
  'other',
];

export function findTopic(topicId) {
  return TOPICS.find((topic) => topic.id === topicId) || null;
}

export function findDifficulty(difficultyId) {
  return DIFFICULTIES.find((difficulty) => difficulty.id === difficultyId) || null;
}

/**
 * The shape the provider must return.
 * `reply` is spoken aloud; `corrections` is shown on screen and logged.
 */
export const REPLY_SCHEMA = {
  type: 'object',
  properties: {
    reply: {
      type: 'string',
      description: 'The conversational reply, spoken aloud to the user.',
    },
    corrections: {
      type: 'array',
      description: 'Mistakes in the user latest message. Empty when the message was fine.',
      items: {
        type: 'object',
        properties: {
          original: { type: 'string', description: 'The exact wrong words the user said.' },
          corrected: { type: 'string', description: 'The same words said correctly.' },
          explanation: { type: 'string', description: 'One short sentence, plain language.' },
          type: { type: 'string', enum: MISTAKE_TYPES },
        },
        required: ['original', 'corrected', 'explanation', 'type'],
      },
    },
  },
  required: ['reply', 'corrections'],
};

/**
 * Builds the system prompt for a session.
 *
 * The correction rules exist because the user's words arrive from speech
 * recognition: no punctuation, no capitals, and the occasional misheard word.
 * Without these rules the model flags typing conventions the user never typed.
 */
export function buildSystemPrompt({ topic, difficulty }) {
  const topicSpec = findTopic(topic) || findTopic(DEFAULT_TOPIC);
  const difficultySpec = findDifficulty(difficulty) || findDifficulty(DEFAULT_DIFFICULTY);

  return [
    'You are an English conversation partner. The user is practising spoken English with you.',
    '',
    `Scenario: ${topicSpec.description}`,
    `Your role: ${topicSpec.role}.`,
    `Level: ${difficultySpec.instruction}`,
    '',
    'Conversation rules:',
    '- Reply the way a real person speaks out loud. Your reply is read aloud, so use no markdown, no lists and no emoji.',
    '- Keep the conversation going. Ask a natural follow-up question on most turns.',
    '- Never mention mistakes, corrections or grammar in your spoken reply. Corrections travel in a separate field.',
    '- Stay in the scenario and keep the thread of what was said earlier.',
    '',
    'Correction rules:',
    '- Judge only the user latest message. Never re-flag anything from earlier turns.',
    '- The message comes from speech recognition. It has no reliable punctuation, capitalisation or spelling.',
    '  Never flag punctuation, capitalisation or spelling.',
    '- Flag only real errors: grammar, verb tense, articles, prepositions, plurals, word order,',
    '  or word choice and phrasing that a fluent speaker would not use.',
    '- Casual spoken English is correct. Contractions, short answers and fragments are not mistakes.',
    '- A word that was clearly misheard by the microphone is not a mistake. Skip it.',
    '- If the message has no real error, return an empty corrections array. Do not invent a mistake.',
    '- Quote the user own words in "original". Change as little as possible in "corrected".',
    '- Keep each explanation to one short sentence a learner can understand.',
  ].join('\n');
}
