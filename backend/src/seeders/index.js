/**
 * seeders/index.js
 * ----------------
 * Database seeder — populates the database with realistic test data
 * for development and testing purposes.
 *
 * This seeder creates:
 *   - 1 moderator
 *   - 2 NGO administrators
 *   - 5 counsellors
 *   - 5 legal counsel
 *   - 20 survivors (each auto-assigned to a counsellor and legal counsel)
 *   - Incident reports (multiple statuses; one escalated to legal case)
 *   - Community rooms with EVERY user enrolled and dense, realistic message
 *     timelines spread over the last month (incl. two flagged messages)
 *   - Multi-turn direct chat conversations for each survivor↔staff pair
 *     (incl. one archived and one deleted channel for Trash/Restore testing).
 *     Message bodies are stored as plaintext: the seeder cannot produce real
 *     E2EE ciphertext (private keys never leave each user's browser), and the
 *     frontend's decryptMessage() renders non-envelope payloads verbatim.
 *   - Notifications, moderation logs
 *   - 12 multi-page educational resource PDFs uploaded to Cloudinary
 *   - OTP requests and USSD callback requests
 *
 * Usage:
 *   node src/seeders/index.js
 *
 * WARNING: This script uses { force: true } on sync — it DROPS and recreates
 * all tables before seeding, and it PURGES the app's Cloudinary folders
 * (incident-reports/, support-resources/, legal-cases/) so orphaned assets
 * from previous seed runs don't accumulate. Only run in development. NEVER
 * run against a production database or a shared Cloudinary environment whose
 * assets you need to keep. The hard guard below aborts if NODE_ENV=production.
 */

require('dotenv').config();

// ── Hard production guard ──────────────────────────────────────────────────
// The force-reset sync will DROP all tables. This cannot be undone. Abort
// immediately when running in a production environment.
if (process.env.NODE_ENV === 'production') {
  console.error(
    '❌ ABORTED: seeders/index.js must not run in a production environment.\n' +
    '   NODE_ENV=production detected. This seeder uses sync({ force: true })\n' +
    '   which DROPS all tables. Unset NODE_ENV or change it to "development".'
  );
  process.exit(1);
}

const { randomUUID } = require('crypto');
const bcrypt = require('bcrypt');
const PDFDocument = require('pdfkit');
const {
  isCloudinaryConfigured,
  purgeSeededAppAssets,
  uploadSupportResourceBuffer,
  uploadEvidenceBuffer,
  uploadLegalDocumentBuffer
} = require('../config/cloudinary');
const { buildLegalCasePdfBuffer } = require('../services/legalDocumentService');
const {
  sequelize,
  UserAccount,
  SurvivorProfile,
  CounsellorProfile,
  LegalCounselProfile,
  NgoAdministratorProfile,
  ModeratorProfile,
  IncidentReport,
  EvidenceFile,
  LegalCaseFile,
  DirectChatChannel,
  DirectChatMessage,
  CommunityRoom,
  RoomMembership,
  CommunityMessage,
  HarmfulContentReport,
  ModerationActionLog,
  AuditLog,
  InAppNotification,
  SupportResource,
  StaffAssignmentHistory,
  UssdCallbackRequest,
  OtpVerificationRequest
} = require('../models');

// ── Helper: hash a password ────────────────────────────────────────────────
/**
 * Hashes a plaintext password using bcrypt with 12 salt rounds.
 *
 * Results are memoised per plaintext: seeded users share a handful of role
 * passwords, and bcrypt-12 is deliberately slow, so hashing each distinct
 * password once (instead of once per user) keeps the ~33-user seed fast.
 * @param {string} plaintext
 * @returns {Promise<string>} bcrypt hash
 */
const hashCache = new Map();
async function hash(plaintext) {
  if (!hashCache.has(plaintext)) {
    hashCache.set(plaintext, await bcrypt.hash(plaintext, 12));
  }
  return hashCache.get(plaintext);
}

// ── Helper: generate a UUID ────────────────────────────────────────────────
const id = () => randomUUID();

/**
 * Returns a Date set to 10:00 AM on `days` days ago.
 * @param {number} days
 * @returns {Date}
 */
function daysAgo(days) {
  const date = new Date();
  date.setHours(10, 0, 0, 0);
  date.setDate(date.getDate() - days);
  return date;
}

const HOUR_MS = 60 * 60 * 1000;

/**
 * Returns a Date set to `hour`:`minute` on `days` days ago — like daysAgo()
 * but with a controllable time of day, so seeded timelines don't all land
 * on the same 10:00 AM timestamp.
 * @param {number} days
 * @param {number} [hour=10]
 * @param {number} [minute=0]
 * @returns {Date}
 */
function daysAgoAt(days, hour = 10, minute = 0) {
  const date = new Date();
  date.setHours(hour, minute, 0, 0);
  date.setDate(date.getDate() - days);
  return date;
}

/**
 * Builds an ascending list of `count` message timestamps ending
 * `lastMessageHoursAgo` hours before now, with deterministic 2–7 hour gaps
 * between consecutive messages (so a conversation reads as spanning a few
 * days rather than being machine-stamped seconds apart).
 * @param {number} count
 * @param {number} lastMessageHoursAgo
 * @returns {Date[]}
 */
function buildConversationTimestamps(count, lastMessageHoursAgo) {
  const times = new Array(count);
  let t = Date.now() - lastMessageHoursAgo * HOUR_MS;
  for (let i = count - 1; i >= 0; i -= 1) {
    times[i] = new Date(t);
    t -= (2 + ((i * 7) % 6)) * HOUR_MS;
  }
  return times;
}


// ── Direct chat conversation scripts ────────────────────────────────────────
// Each script is an ordered list of turns: { from: 'survivor'|'staff', text }.
// Scripts are rotated across survivors (index % scripts.length); script [0]
// is the longest and lands on the primary demo pair (+254711000001).
// Bodies are stored as plaintext — see the module header for why seeded
// messages can't be real E2EE ciphertext.

const COUNSELLOR_SCRIPTS = [
  [
    { from: 'survivor', text: 'Hello. I was told you are my assigned counsellor. I am not sure where to start.' },
    { from: 'staff',    text: 'Hello, and welcome. I am glad you reached out — that first message is often the hardest part. There is no right place to start; we can go at whatever pace feels okay for you.' },
    { from: 'survivor', text: 'Thank you. Things at home have been difficult for a while. I have not really talked about it with anyone.' },
    { from: 'staff',    text: 'I hear you. Keeping it inside for a long time is exhausting. You do not need to share details until you are ready — how are you feeling today, right now?' },
    { from: 'survivor', text: 'Tired mostly. I have not been sleeping well. My mind keeps replaying things at night.' },
    { from: 'staff',    text: 'That is a very common response to what you have been carrying. When your mind races at night, try the 5-4-3-2-1 grounding exercise: name 5 things you can see, 4 you can touch, 3 you can hear, 2 you can smell, 1 you can taste. It helps interrupt the spiral.' },
    { from: 'survivor', text: 'I will try that tonight. Does it really help?' },
    { from: 'staff',    text: 'For many people, yes — especially paired with slow breathing: in for 4 counts, hold for 4, out for 4. It will not fix everything, but it can give you back a little control in the moment.' },
    { from: 'survivor', text: 'I tried the breathing exercise last night. I actually managed to fall asleep faster.' },
    { from: 'staff',    text: 'That is really good progress. Small tools like that add up. Would you feel comfortable scheduling a proper session this week so we can talk through things more fully?' },
    { from: 'survivor', text: 'Yes, I think I am ready for that. Afternoons are safest for me to talk.' },
    { from: 'staff',    text: 'Afternoons work well. I have set aside Thursday at 3 PM for you. If anything changes or that time stops being safe, just message me here — we can always adjust.' },
    { from: 'survivor', text: 'Thursday at 3 PM works. Thank you for being patient with me.' },
    { from: 'staff',    text: 'You never need to thank me for patience — this is your space and your pace. One more thing before Thursday: if you ever feel in immediate danger, call 999 or the GBV helpline 1195 first, then reach me. Your safety always comes first.' },
    { from: 'survivor', text: 'Understood. I have saved both numbers under a different name in my phone.' },
    { from: 'staff',    text: 'Very wise. I will check in tomorrow morning as well. You are doing better than you think — see you Thursday.' }
  ],
  [
    { from: 'survivor', text: 'Hi. I have been feeling very anxious this week, worse than usual.' },
    { from: 'staff',    text: 'Thank you for telling me. Anxiety spikes are common after everything you have been through. Did something specific happen this week, or has it been building?' },
    { from: 'survivor', text: 'It has been building. I keep worrying about running into him in town.' },
    { from: 'staff',    text: 'That fear makes complete sense. Let us work on a plan for it: which routes and times feel safest for you, and is there someone who can accompany you for errands this week?' },
    { from: 'survivor', text: 'My sister can come with me on Saturday. I feel better when she is around.' },
    { from: 'staff',    text: 'Good — lean on that support. Also keep your phone charged and the quick numbers saved. For the anxiety itself, try box breathing when you feel it rising: in 4, hold 4, out 4, hold 4.' },
    { from: 'survivor', text: 'I used the breathing at the market today and it helped me stay calm.' },
    { from: 'staff',    text: 'Well done — genuinely. Using a tool in the moment, in a real situation, is a big step. How has your sleep been?' },
    { from: 'survivor', text: 'A bit better. Still waking up early but I fall back asleep sometimes now.' },
    { from: 'staff',    text: 'That is moving in the right direction. Let us keep our session on Wednesday and review the safety plan together then. Message me any time before that if the anxiety spikes again.' },
    { from: 'survivor', text: 'Thank you. Wednesday is fine. I will keep practising the breathing.' },
    { from: 'staff',    text: 'You are doing the work, and it shows. Rest well tonight — I will see you Wednesday.' }
  ],
  [
    { from: 'survivor', text: 'Hello. I need to talk about something that happened at home yesterday.' },
    { from: 'staff',    text: 'I am here and listening. Are you somewhere safe right now?' },
    { from: 'survivor', text: 'Yes, I am at my aunt\'s place for now. Things escalated again last night.' },
    { from: 'staff',    text: 'I am very glad you got yourself somewhere safe — that took presence of mind. Staying with your aunt for a few days sounds wise. Do you have what you need there: documents, medication, some money?' },
    { from: 'survivor', text: 'I took my ID and phone but left in a hurry. Most of my things are still at the house.' },
    { from: 'staff',    text: 'Your safety matters more than the things — those can be retrieved later with support, possibly with a police escort. Let us not have you go back alone. Would you like me to connect you with the safe-shelter referral desk as a backup option?' },
    { from: 'survivor', text: 'Yes please. I do not want to burden my aunt for too long.' },
    { from: 'staff',    text: 'It is arranged — the shelter intake desk will expect your call this week; I have shared the contact in your resources. You are not a burden to anyone. How are you holding up emotionally?' },
    { from: 'survivor', text: 'Shaken, but calmer than yesterday. Talking about it here helps.' },
    { from: 'staff',    text: 'You have handled an extremely difficult situation with real strength. Rest today. Tomorrow we can talk through next steps together, including whether you want to involve your legal counsel.' },
    { from: 'survivor', text: 'Okay. I think I do want to talk to the legal counsel about a protection order.' },
    { from: 'staff',    text: 'That is a strong, protective choice — I will let them know to expect you in your legal chat. I will check on you tomorrow morning. You are not alone in this.' }
  ],
  [
    { from: 'survivor', text: 'Good morning. Just checking in like we agreed.' },
    { from: 'staff',    text: 'Good morning! I am glad you kept our check-in. How did the week go overall?' },
    { from: 'survivor', text: 'Better than last week. I only had one really hard day, on Tuesday.' },
    { from: 'staff',    text: 'One hard day out of seven is real progress — a month ago you told me every day felt heavy. What helped you get through Tuesday?' },
    { from: 'survivor', text: 'I wrote in the journal like you suggested. It felt strange at first but it helped get things out of my head.' },
    { from: 'staff',    text: 'Journaling suits you, then — keep it somewhere private and safe. Try adding one line each day: “one thing I did well today.” It trains the mind to notice your own strength.' },
    { from: 'survivor', text: 'I like that idea. Yesterday I would have written that I cooked a proper meal for the first time in weeks.' },
    { from: 'staff',    text: 'That is exactly it — and it is not a small thing. Appetite and routine coming back are signs of recovery. Shall we keep the same check-in time next week?' },
    { from: 'survivor', text: 'Yes, same time works for me. Thank you for noticing the small things.' },
    { from: 'staff',    text: 'The small things are the recovery. Have a gentle week — I am here if anything comes up before our check-in.' }
  ],
  [
    { from: 'survivor', text: 'Hi. My family keeps pressuring me to “fix things” and go back. I feel very alone with this.' },
    { from: 'staff',    text: 'I am sorry — that pressure from the people closest to you cuts deep. Let me say this clearly: you are not responsible for fixing what someone else broke, and choosing your safety is not abandoning your family.' },
    { from: 'survivor', text: 'They say I am embarrassing them. Sometimes I wonder if they are right and I am overreacting.' },
    { from: 'staff',    text: 'What you described to me was not an overreaction — it was a reasonable response to real harm. Doubt like this is very common when family minimises what happened. Your feelings are valid evidence too.' },
    { from: 'survivor', text: 'Hearing that helps. My cousin is the only one who supports my decision.' },
    { from: 'staff',    text: 'Then your cousin is your anchor right now — keep that line open. You might also find the General Support Circle in the community rooms helpful; others there have faced the same family pressure.' },
    { from: 'survivor', text: 'I joined the room yesterday actually. Reading others\' messages made me feel less alone.' },
    { from: 'staff',    text: 'I am really glad. Isolation is the hardest part, and you are already breaking it. In our next session, let us prepare some calm responses you can use when family raises the topic, so it stops draining you.' },
    { from: 'survivor', text: 'Yes, I would really like that. The conversations always catch me off guard.' },
    { from: 'staff',    text: 'Then we will rehearse them together until they do not. You have been steadier every week — hold onto that. Talk soon.' },
    { from: 'survivor', text: 'Thank you. Talk soon.' }
  ]
];

const LEGAL_SCRIPTS = [
  [
    { from: 'survivor', text: 'Hello. My counsellor suggested I speak with you about my legal options.' },
    { from: 'staff',    text: 'Hello, welcome. I have familiarised myself with your case file. We can move entirely at your pace — nothing is filed or reported without your consent. What would you like to understand first?' },
    { from: 'survivor', text: 'I want to know what happens if I report to the police. I am worried it becomes public.' },
    { from: 'staff',    text: 'A fair concern. GBV reports are handled by gender desks with confidentiality obligations, and you can request that proceedings be held in camera — meaning closed to the public. Your identity is protected in the court record.' },
    { from: 'survivor', text: 'Okay. What documents would I need to start?' },
    { from: 'staff',    text: 'Three key items: an OB number from the police station where you report, a P3 form (the official medical examination form), and if applicable a PRC form from the hospital. The P3 and PRC are free at public health facilities.' },
    { from: 'survivor', text: 'I did go to the hospital after the last incident. They gave me some papers.' },
    { from: 'staff',    text: 'Excellent — those hospital records are valuable. Keep the originals somewhere safe and photograph each page as backup. With your consent, I can review them at our next appointment to see if a PRC form was completed.' },
    { from: 'survivor', text: 'Yes, I consent. I also wanted to ask about a protection order. Can I get one without a criminal case?' },
    { from: 'staff',    text: 'Yes — that is an important point. Under the Protection Against Domestic Violence Act (2015), you can apply for a protection order in a magistrate\'s court independently of any criminal case. If breached, the breach itself is an offence police can act on immediately.' },
    { from: 'survivor', text: 'How long does the protection order take?' },
    { from: 'staff',    text: 'An interim order can be issued the same day you apply, ex parte — without the other party present — if the court is satisfied there is risk. The full hearing follows within a few weeks. I will prepare the application; you would need to sign it and attend briefly.' },
    { from: 'survivor', text: 'Then I would like to go ahead with the protection order application.' },
    { from: 'staff',    text: 'Understood. I will draft it this week and we will review it together before anything is filed. I have also updated your case file to reflect this decision. You are making a well-protected, well-informed choice.' },
    { from: 'survivor', text: 'Thank you for explaining everything so clearly. I feel less afraid of the process now.' },
    { from: 'staff',    text: 'That is exactly my job. One practical note: keep a small written log of any further incidents — date, time, what happened, any witnesses. It strengthens both the order application and any future case. I will message you when the draft is ready.' }
  ],
  [
    { from: 'survivor', text: 'Good afternoon. I want to ask about applying for a protection order.' },
    { from: 'staff',    text: 'Good afternoon. I can certainly help with that. A protection order under the PADV Act (2015) prohibits the named person from abusing, threatening, or in some cases contacting or approaching you. Are you currently living in the same home as them?' },
    { from: 'survivor', text: 'No, I moved to my brother\'s place last month. But he keeps showing up there.' },
    { from: 'staff',    text: 'Then the order can specifically prohibit him from approaching your brother\'s residence and your workplace. Each time he has shown up — do you have dates, or did anyone else see him?' },
    { from: 'survivor', text: 'My brother saw him twice. I have the dates in my phone notes.' },
    { from: 'staff',    text: 'Very good — those notes and your brother\'s account are exactly what the application needs. I will prepare an affidavit for you and a short witness statement for your brother, if he is willing.' },
    { from: 'survivor', text: 'He is willing. What happens after we file?' },
    { from: 'staff',    text: 'The magistrate can grant an interim order quickly, often the same day. It takes effect once served on him. If he breaches it — shows up again — call 999, report the breach with your order number, and inform me immediately.' },
    { from: 'survivor', text: 'That is reassuring. How much will this cost me?' },
    { from: 'staff',    text: 'Nothing through this platform — my services are provided by the NGO, and court filing fees for protection orders are minimal and can be waived. Cost should never stop you from being safe.' },
    { from: 'survivor', text: 'Thank you. Please go ahead and prepare the documents.' },
    { from: 'staff',    text: 'I will have the affidavit ready for your review by Friday. Until then, keep noting any incident with date and time, and stay close to your brother when he is around. I will message you Friday morning.' }
  ],
  [
    { from: 'survivor', text: 'Hi. I have been keeping records like you advised. What else counts as evidence?' },
    { from: 'staff',    text: 'Good question, and well done for keeping the log. Useful evidence includes: your written incident log, photographs of injuries or damage, medical records (P3/PRC forms), threatening messages or call logs, and statements from anyone who witnessed incidents.' },
    { from: 'survivor', text: 'I have screenshots of threatening messages he sent me. Do those count?' },
    { from: 'staff',    text: 'Yes — very much so. Keep the original messages on the phone if you safely can; screenshots alone are good, but the originals carry more weight. Back them up somewhere he cannot access, such as a private email to yourself.' },
    { from: 'survivor', text: 'Done. I emailed them to my private account yesterday.' },
    { from: 'staff',    text: 'Excellent instincts. One caution: do not engage or reply to provocations — responses can be taken out of context later. Preserve, do not participate.' },
    { from: 'survivor', text: 'Understood. Should I also upload these to my report on this platform?' },
    { from: 'staff',    text: 'Yes, please do — the evidence upload on your report is private and only visible to your assigned team. It also means nothing is lost if something happens to your phone.' },
    { from: 'survivor', text: 'I have uploaded the screenshots and the photo of the medical slip.' },
    { from: 'staff',    text: 'Received and noted in your case file. This is shaping into a well-documented case. We will review everything together at our appointment on Monday.' }
  ],
  [
    { from: 'survivor', text: 'Hello. I reported at the police station like we discussed, but I have heard nothing for two weeks.' },
    { from: 'staff',    text: 'Thank you for the update, and I am sorry about the silence — follow-up delays are unfortunately common. Do you have the OB number from the day you reported?' },
    { from: 'survivor', text: 'Yes, I wrote it down: it is in my notes with the date.' },
    { from: 'staff',    text: 'Perfect. With your consent, I will make a formal follow-up with the station\'s gender desk citing that OB number, and copy the investigating officer\'s supervisor. A lawyer\'s letter usually restarts a stalled file.' },
    { from: 'survivor', text: 'Yes, you have my consent. Will this annoy the police and hurt my case?' },
    { from: 'staff',    text: 'No — follow-up is your legal right, and it is routine professional correspondence. Investigating officers handle many files; a formal reminder moves yours up, it does not mark it down.' },
    { from: 'survivor', text: 'Okay, that is a relief. What happens if they still do nothing?' },
    { from: 'staff',    text: 'Then we escalate: the Internal Affairs Unit and IPOA exist for inaction complaints, and the file can also be brought to the ODPP\'s attention. There are several rungs on this ladder — we are only on the first.' },
    { from: 'survivor', text: 'Thank you. I was starting to think reporting was pointless.' },
    { from: 'staff',    text: 'It was not pointless — your OB entry, the P3 form, and your report here are all on record and dated. The system can be slow, but your case is properly anchored. I will send the follow-up letter tomorrow and update you by Thursday.' },
    { from: 'survivor', text: 'I appreciate it. Talk on Thursday then.' }
  ],
  [
    { from: 'survivor', text: 'Good morning. I need advice about my children. I am afraid he will try to take them from me.' },
    { from: 'staff',    text: 'Good morning. I understand this fear — let me reassure you on the law first: as their primary caregiver, you have strong standing. Removing children from you without a court order is not something he is entitled to do.' },
    { from: 'survivor', text: 'He said the children belong to his family and I have no say.' },
    { from: 'staff',    text: 'That is a common intimidation line and it is not the law. The Children Act (2022) makes the child\'s best interests paramount, and both parents have equal parental responsibility. Courts do not remove children from a safe, caring parent.' },
    { from: 'survivor', text: 'Can I do anything now, before he tries something?' },
    { from: 'staff',    text: 'Yes. We can include the children in your protection order so it covers them too, and we can file for a formal custody arrangement at the Children\'s Court so your position is legally recorded rather than just factual.' },
    { from: 'survivor', text: 'Please include them in the order. The custody filing — how long does it take?' },
    { from: 'staff',    text: 'The children\'s inclusion in the protection order is immediate when granted. The custody matter takes longer — a few months — but an interim custody order can be sought early in the process. Meanwhile, keep the children\'s birth certificates and clinic cards with you or somewhere safe.' },
    { from: 'survivor', text: 'Their documents are already at my mother\'s house, locked away.' },
    { from: 'staff',    text: 'Very well prepared. I will amend the protection order draft to include the children today, and prepare the Children\'s Court paperwork for our next meeting. Your children are safer than his threats suggest — the law is on your side here.' },
    { from: 'survivor', text: 'Thank you so much. This has been weighing on me for weeks.' }
  ]
];

// Short, fully-read historical threads for the special-status channels. Both
// end on a survivor turn so no unread-tail is left behind in a channel the
// survivor has archived or deleted.
const ARCHIVED_CHANNEL_SCRIPT = [
  { from: 'survivor', text: 'Hello. Thank you for the sessions over the past month.' },
  { from: 'staff',    text: 'It has been a privilege to walk alongside you. How are you feeling about where things stand now?' },
  { from: 'survivor', text: 'Much steadier. I am sleeping better and I have started my small business again.' },
  { from: 'staff',    text: 'That is wonderful to hear — routine and purpose returning are strong signs. Remember the door here stays open; you can message any time.' },
  { from: 'survivor', text: 'I will. For now I feel ready to stand on my own for a while. Thank you for everything.' }
];

const DELETED_CHANNEL_SCRIPT = [
  { from: 'survivor', text: 'Hello. I had a question about the paperwork you mentioned.' },
  { from: 'staff',    text: 'Of course — the affidavit needs your ID number and two dates confirmed. You can send them here when ready.' },
  { from: 'survivor', text: 'I have decided to pause the legal process for now. I need some time first.' },
  { from: 'staff',    text: 'That is completely your right, and the pause changes nothing about your options — everything can resume whenever you choose. Take the time you need.' },
  { from: 'survivor', text: 'Thank you for understanding. I will reach out when I am ready.' }
];

/**
 * Bulk-creates one seeded direct-chat conversation with app-consistent
 * delivery metadata: ascending dispatch timestamps (2–7h apart, ending
 * `lastMessageHoursAgo` hours ago), deliveredAt set on every message, and
 * every message READ + seenAt except a trailing staff-sent message, which is
 * left UNREAD with no seenAt — so survivors see an unread badge and staff
 * see Sent/Delivered ticks, exactly as the live app would produce.
 * @param {object} options
 * @param {string} options.chatId
 * @param {string} options.survivorUserId
 * @param {string} options.staffUserId
 * @param {Array<{from: string, text: string}>} options.script
 * @param {number} options.lastMessageHoursAgo
 * @returns {Promise<number>} Number of messages created.
 */
async function seedDirectConversation({ chatId, survivorUserId, staffUserId, script, lastMessageHoursAgo }) {
  const times = buildConversationTimestamps(script.length, lastMessageHoursAgo);
  const lastIndex = script.length - 1;

  const rows = script.map((turn, index) => {
    const isStaff = turn.from === 'staff';
    // Only a conversation-final staff message stays unread (the survivor
    // hasn't opened it yet); everything earlier has been read by both sides.
    const isUnreadTail = isStaff && index === lastIndex;
    const dispatchedAt = times[index];

    return {
      messageId:                id(),
      chatId,
      senderUserId:             isStaff ? staffUserId : survivorUserId,
      encryptedMessageContent:  turn.text,
      messageDispatchTimestamp: dispatchedAt,
      deliveredAt:              new Date(dispatchedAt.getTime() + 60 * 1000),
      messageReadStatus:        isUnreadTail ? 'UNREAD' : 'READ',
      // markChannelRead (chatController.js) always sets seenAt atomically
      // with READ — the tick display relies on seenAt being present.
      seenAt:                   isUnreadTail ? null : new Date(dispatchedAt.getTime() + 5 * 60 * 1000)
    };
  });

  await DirectChatMessage.bulkCreate(rows);
  return rows.length;
}

// ── Helper: render a simple one-page PDF into a Buffer ─────────────────────
/**
 * Renders a short PDF (title + body paragraph) into a Buffer using pdfkit —
 * the same library the real legal-document generation path uses. Seeded
 * resources/evidence upload this buffer to Cloudinary via the same helpers
 * (`uploadSupportResourceBuffer`, `uploadEvidenceBuffer`) the live app uses,
 * so seeded files are real, downloadable Cloudinary assets rather than
 * placeholder URLs.
 * @param {{ title: string, body: string }} options
 * @returns {Promise<Buffer>}
 */
function buildSimplePdfBuffer({ title, body }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 60, size: 'A4' });
    const chunks = [];

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fillColor('#6c3483').fontSize(16).font('Helvetica-Bold').text(title);
    doc.moveDown(1);
    doc.fillColor('#2c2c2c').fontSize(11).font('Helvetica').text(body, { lineGap: 4 });

    doc.end();
  });
}

// ── Helper: render a multi-page educational PDF into a Buffer ──────────────
/**
 * Renders a structured, multi-page educational document with pdfkit: a title
 * block, then a sequence of sections (heading + paragraphs / bullet list /
 * contact rows), and a per-page footer with a disclaimer and page numbers.
 * Used for the seeded library resources so downloads are genuinely useful
 * sample documents rather than one-paragraph placeholders.
 * @param {object} options
 * @param {string} options.title
 * @param {string} [options.subtitle]
 * @param {Array<{heading: string, paragraphs?: string[], bullets?: string[],
 *   contacts?: Array<{name: string, detail: string}>}>} options.sections
 * @returns {Promise<Buffer>}
 */
function buildResourcePdfBuffer({ title, subtitle, sections }) {
  return new Promise((resolve, reject) => {
    // bufferPages lets us revisit every page at the end to stamp footers.
    const doc = new PDFDocument({ margin: 60, size: 'A4', bufferPages: true });
    const chunks = [];

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const contentWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;

    // Title block with an accent rule under it.
    doc.fillColor('#6c3483').fontSize(20).font('Helvetica-Bold').text(title);
    if (subtitle) {
      doc.moveDown(0.3);
      doc.fillColor('#555555').fontSize(11.5).font('Helvetica-Oblique').text(subtitle);
    }
    doc.moveDown(0.6);
    doc.strokeColor('#6c3483').lineWidth(1.5)
      .moveTo(doc.page.margins.left, doc.y)
      .lineTo(doc.page.margins.left + contentWidth, doc.y)
      .stroke();
    doc.moveDown(1.2);

    for (const section of sections) {
      doc.fillColor('#6c3483').fontSize(13).font('Helvetica-Bold').text(section.heading);
      doc.moveDown(0.4);
      doc.fillColor('#2c2c2c').fontSize(10.5).font('Helvetica');

      for (const paragraph of section.paragraphs || []) {
        doc.text(paragraph, { lineGap: 3 });
        doc.moveDown(0.5);
      }
      for (const bullet of section.bullets || []) {
        doc.text(`•   ${bullet}`, { indent: 10, lineGap: 3 });
        doc.moveDown(0.25);
      }
      for (const contact of section.contacts || []) {
        doc.font('Helvetica-Bold').text(contact.name, { continued: true, lineGap: 3 })
          .font('Helvetica').text(`  —  ${contact.detail}`);
        doc.moveDown(0.25);
      }
      doc.moveDown(0.9);
    }

    // Footer pass: disclaimer + page number on every buffered page. The
    // bottom margin is zeroed per page while stamping so writing inside the
    // margin band doesn't trigger pdfkit's automatic page-add.
    const range = doc.bufferedPageRange();
    for (let pageIndex = range.start; pageIndex < range.start + range.count; pageIndex += 1) {
      doc.switchToPage(pageIndex);
      const savedBottomMargin = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;

      doc.fontSize(7.5).fillColor('#888888').font('Helvetica').text(
        'This material is for general information and support. It is not a substitute for professional medical, psychological, or legal advice.',
        doc.page.margins.left,
        doc.page.height - 46,
        { width: contentWidth, align: 'center', lineGap: 2 }
      );
      doc.text(`Page ${pageIndex + 1} of ${range.count}`, doc.page.margins.left, doc.page.height - 24, {
        width: contentWidth,
        align: 'center'
      });

      doc.page.margins.bottom = savedBottomMargin;
    }

    doc.end();
  });
}

// ── A minimal valid 1x1 PNG, used as seeded evidence "photo" bytes ─────────
const PLACEHOLDER_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';


// ════════════════════════════════════════════════════════════════════════════
// SEED FUNCTION
// ════════════════════════════════════════════════════════════════════════════

async function seed() {
  try {
    await sequelize.authenticate();
    console.log('✅ Database connection established.');

    // Drop and recreate all tables — development only.
    await sequelize.sync({ force: true });
    console.log('✅ Tables reset and recreated.');

    // Purge every asset from previous seed runs BEFORE uploading fresh ones —
    // each run uploads new UUID-named files, so without this the Cloudinary
    // account accumulates orphans indefinitely.
    if (isCloudinaryConfigured()) {
      console.log('🧹 Purging previous seed assets from Cloudinary...');
      await purgeSeededAppAssets();
    } else {
      console.log('⚠️  Cloudinary not configured — skipping asset purge (uploads below will fail).');
    }


    // ── 1. MODERATORS ─────────────────────────────────────────────────────

    console.log('🌱 Seeding moderators...');

    const moderatorUserId1 = id();
    await UserAccount.create({
      userId:        moderatorUserId1,
      phoneNumber:   '+254700000001',
      hashedPassword: await hash('Moderator@2026!'),
      userRole:      'MODERATOR',
      accountStatus: 'ACTIVE',
      isOtpVerified: true
    });
    await ModeratorProfile.create({
      moderatorId:           id(),
      userId:                moderatorUserId1,
      currentWorkloadScore:  0
    });


    // ── 2. NGO ADMINISTRATORS ────────────────────────────────────────────

    console.log('🌱 Seeding NGO administrators...');

    const ngoAdminUserId1 = id();
    const ngoAdminId1     = id();
    await UserAccount.create({
      userId:        ngoAdminUserId1,
      phoneNumber:   '+254700000010',
      hashedPassword: await hash('NgoAdmin@2026!'),
      userRole:      'NGO_ADMIN',
      accountStatus: 'ACTIVE',
      isOtpVerified: true
    });
    await NgoAdministratorProfile.create({
      ngoAdminId:               ngoAdminId1,
      userId:                   ngoAdminUserId1,
      administrativeDepartment: 'Case Management',
      administratorAccessLevel: 2
    });

    const ngoAdminUserId2 = id();
    const ngoAdminId2     = id();
    await UserAccount.create({
      userId:        ngoAdminUserId2,
      phoneNumber:   '+254700000011',
      hashedPassword: await hash('NgoAdmin2@2026!'),
      userRole:      'NGO_ADMIN',
      accountStatus: 'ACTIVE',
      isOtpVerified: true
    });
    await NgoAdministratorProfile.create({
      ngoAdminId:               ngoAdminId2,
      userId:                   ngoAdminUserId2,
      administrativeDepartment: 'Community Support',
      administratorAccessLevel: 1
    });


    // ── 3. COUNSELLORS ───────────────────────────────────────────────────

    console.log('🌱 Seeding counsellors...');

    const counsellorData = [
      { phone: '+254700000020', spec: 'Trauma Counselling',        county: 'Nairobi',     workload: 0 },
      { phone: '+254700000021', spec: 'Domestic Violence Support', county: 'Mombasa',     workload: 0 },
      { phone: '+254700000022', spec: 'Psychosocial Support',      county: 'Kisumu',      workload: 0 },
      { phone: '+254700000023', spec: 'Crisis Intervention',       county: 'Nakuru',      workload: 0 },
      { phone: '+254700000024', spec: 'Family Therapy',            county: 'Uasin Gishu', workload: 0 }
    ];

    const counsellorIds    = [];  // { counsellorId, county } — for survivor assignment
    const counsellorUserIds = []; // UserAccount userId — for channel population

    for (const c of counsellorData) {
      const userId       = id();
      const counsellorId = id();
      counsellorUserIds.push(userId);
      counsellorIds.push({ counsellorId, county: c.county });

      await UserAccount.create({
        userId,
        phoneNumber:    c.phone,
        hashedPassword: await hash('Counsellor@2026!'),
        userRole:       'COUNSELLOR',
        accountStatus:  'ACTIVE',
        isOtpVerified:  true
      });
      await CounsellorProfile.create({
        counsellorId,
        userId,
        professionalSpecialization: c.spec,
        currentWorkloadScore:       c.workload,
        availabilityStatus:         'AVAILABLE'
      });
    }


    // ── 4. LEGAL COUNSEL ─────────────────────────────────────────────────

    console.log('🌱 Seeding legal counsel...');

    const legalData = [
      { phone: '+254700000030', spec: 'Family Law',           county: 'Nairobi',     workload: 0 },
      { phone: '+254700000031', spec: 'Criminal Law',         county: 'Mombasa',     workload: 0 },
      { phone: '+254700000032', spec: 'Human Rights Law',     county: 'Kisumu',      workload: 0 },
      { phone: '+254700000033', spec: 'Children & Family Law', county: 'Nakuru',      workload: 0 },
      { phone: '+254700000034', spec: 'Civil Litigation',      county: 'Uasin Gishu', workload: 0 }
    ];

    const legalCounselIds     = [];  // { legalCounselId, county } — for survivor assignment
    const legalCounselUserIds = [];  // UserAccount userId — for channel population

    for (const l of legalData) {
      const userId         = id();
      const legalCounselId = id();
      legalCounselUserIds.push(userId);
      legalCounselIds.push({ legalCounselId, county: l.county });

      await UserAccount.create({
        userId,
        phoneNumber:    l.phone,
        hashedPassword: await hash('LegalCounsel@2026!'),
        userRole:       'LEGAL_COUNSEL',
        accountStatus:  'ACTIVE',
        isOtpVerified:  true
      });
      await LegalCounselProfile.create({
        legalCounselId,
        userId,
        professionalSpecialization: l.spec,
        currentWorkloadScore:       l.workload,
        availabilityStatus:         'AVAILABLE'
      });
    }


    // ── 5. SURVIVORS ─────────────────────────────────────────────────────

    console.log('🌱 Seeding survivors...');

    /**
     * Auto-assignment: match survivor to counsellor/legal counsel in the same county.
     * Falls back to first available if no county match (simplified for seed).
     * @param {string} county
     * @param {Array<object>} staffArray
     */
    function assignStaff(county, staffArray) {
      return staffArray.find(s => s.county === county) || staffArray[0];
    }

    // The first five entries are the original demo accounts — keep their
    // phones, nicknames, and order untouched (the presentation depends on
    // them). Entries 6–20 widen the roster across all five staffed counties.
    const survivorData = [
      { phone: '+254711000001', nickname: 'Starlight',       gender: 'Female', county: 'Nairobi'     },
      { phone: '+254711000002', nickname: 'Brave Heart',     gender: 'Female', county: 'Nairobi'     },
      { phone: '+254711000003', nickname: 'Rising Dawn',     gender: 'Female', county: 'Mombasa'     },
      { phone: '+254711000004', nickname: 'Still Waters',    gender: 'Male',   county: 'Kisumu'      },
      { phone: '+254711000005', nickname: 'New Horizon',     gender: 'Female', county: 'Mombasa'     },
      { phone: '+254711000006', nickname: 'Quiet Strength',  gender: 'Female', county: 'Nakuru'      },
      { phone: '+254711000007', nickname: 'Morning Star',    gender: 'Female', county: 'Uasin Gishu' },
      { phone: '+254711000008', nickname: 'Safe Harbour',    gender: 'Male',   county: 'Nairobi'     },
      { phone: '+254711000009', nickname: 'Green Valley',    gender: 'Female', county: 'Kisumu'      },
      { phone: '+254711000010', nickname: 'Open Sky',        gender: 'Female', county: 'Nakuru'      },
      { phone: '+254711000011', nickname: 'River Stone',     gender: 'Male',   county: 'Mombasa'     },
      { phone: '+254711000012', nickname: 'Bright Path',     gender: 'Female', county: 'Uasin Gishu' },
      { phone: '+254711000013', nickname: 'Gentle Rain',     gender: 'Female', county: 'Nairobi'     },
      { phone: '+254711000014', nickname: 'True North',      gender: 'Female', county: 'Kisumu'      },
      { phone: '+254711000015', nickname: 'Golden Hour',     gender: 'Female', county: 'Nakuru'      },
      { phone: '+254711000016', nickname: 'Deep Roots',      gender: 'Male',   county: 'Mombasa'     },
      { phone: '+254711000017', nickname: 'First Light',     gender: 'Female', county: 'Uasin Gishu' },
      { phone: '+254711000018', nickname: 'Calm Waters',     gender: 'Female', county: 'Nairobi'     },
      { phone: '+254711000019', nickname: 'Steady Flame',    gender: 'Female', county: 'Kisumu'      },
      { phone: '+254711000020', nickname: 'New Chapter',     gender: 'Male',   county: 'Nakuru'      }
    ];

    const survivorIds         = [];
    const survivorUserIds     = [];
    // Persist assignment pairing keyed by index for channel verification later.
    const survivorAssignments = [];

    for (const s of survivorData) {
      const userId     = id();
      const survivorId = id();
      survivorUserIds.push(userId);
      survivorIds.push(survivorId);

      const assignedCounsellor   = assignStaff(s.county, counsellorIds);
      const assignedLegalCounsel = assignStaff(s.county, legalCounselIds);

      // Resolve UserAccount userIds for channel wiring.
      const counsellorUserId   = counsellorUserIds[counsellorIds.indexOf(assignedCounsellor)];
      const legalCounselUserId = legalCounselUserIds[legalCounselIds.indexOf(assignedLegalCounsel)];
      survivorAssignments.push({
        survivorId,
        counsellorUserId,
        legalCounselUserId,
        counsellorId:   assignedCounsellor.counsellorId,
        legalCounselId: assignedLegalCounsel.legalCounselId
      });

      await UserAccount.create({
        userId,
        phoneNumber:    s.phone,
        hashedPassword: await hash('Survivor@2026!'),
        userRole:       'SURVIVOR',
        accountStatus:  'ACTIVE',
        isOtpVerified:  true
      });

      await SurvivorProfile.create({
        survivorId,
        userId,
        displayNickname:        s.nickname,
        assignedGender:         s.gender,
        residenceCounty:        s.county,
        assignedCounsellorId:   assignedCounsellor.counsellorId,
        assignedLegalCounselId: assignedLegalCounsel.legalCounselId,
        privacyPreferencesJson: { notificationsEnabled: true }
      });

      await StaffAssignmentHistory.create({
        assignmentHistoryId: id(),
        survivorId,
        counsellorId:        assignedCounsellor.counsellorId,
        legalCounselId:      assignedLegalCounsel.legalCounselId,
        assignmentReason:    'Initial auto-assignment at registration'
      });

      // Mirror ensureSurvivorStaffAutoAssignment's workload increment
      // (authController.js) so seeded staff show a currentWorkloadScore that
      // matches their actual assigned-survivor count instead of staying at 0.
      await CounsellorProfile.increment('currentWorkloadScore', {
        where: { counsellorId: assignedCounsellor.counsellorId }
      });
      await LegalCounselProfile.increment('currentWorkloadScore', {
        where: { legalCounselId: assignedLegalCounsel.legalCounselId }
      });
    }


    // ── 6. INCIDENT REPORTS ──────────────────────────────────────────────

    console.log('🌱 Seeding incident reports...');

    const reportId1 = id();
    const reportId2 = id();
    const reportId3 = id();

    await IncidentReport.create({
      reportId:                reportId1,
      survivorId:              survivorIds[0],
      incidentCategory:        'domestic_violence',
      severityLevel:           'HIGH',
      incidentDescriptionText: 'Repeated incidents at home over the past three months. Increasing frequency.',
      incidentLocation:        'Nairobi, Eastlands',
      incidentDate:            '2026-04-15',
      currentReportStatus:     'UNDER_REVIEW',
      reportCreationTimestamp: daysAgo(29)
    });

    // Real Cloudinary upload — makes GET /api/reports/:id/evidence/:id/file
    // actually streamable instead of pointing at a fake public_id.
    const evidencePhotoBuffer = Buffer.from(PLACEHOLDER_PNG_BASE64, 'base64');
    const evidencePhotoUpload = await uploadEvidenceBuffer({
      buffer:   evidencePhotoBuffer,
      reportId: reportId1,
      mimeType: 'image/png'
    });
    await EvidenceFile.create({
      evidenceFileId:             id(),
      reportId:                   reportId1,
      evidenceFileType:           'image',
      originalFileName:           'evidence_photo.png',
      fileSize:                   evidencePhotoBuffer.length,
      mimeType:                   'image/png',
      cloudinaryPublicIdentifier: evidencePhotoUpload.public_id,
      dynamicallySignedUrl:       evidencePhotoUpload.secure_url
    });

    await IncidentReport.create({
      reportId:                reportId2,
      survivorId:              survivorIds[1],
      incidentCategory:        'sexual_violence',
      severityLevel:           'CRITICAL',
      incidentDescriptionText: 'Incident occurred on the stated date. Medical attention was sought.',
      incidentLocation:        'Nairobi, CBD',
      incidentDate:            '2026-05-01',
      currentReportStatus:     'ESCALATED_TO_LEGAL_CASE',
      reportCreationTimestamp: daysAgo(25)
    });

    // Second evidence type (PDF) on the escalated report for coverage variety.
    const evidenceDocBuffer = await buildSimplePdfBuffer({
      title: 'Incident Documentation — Medical Note Summary',
      body:  'Summary note prepared following the incident described in this report. ' +
             'Attached for reference by the assigned counsellor and legal counsel during case review.'
    });
    const evidenceDocUpload = await uploadEvidenceBuffer({
      buffer:   evidenceDocBuffer,
      reportId: reportId2,
      mimeType: 'application/pdf'
    });
    await EvidenceFile.create({
      evidenceFileId:             id(),
      reportId:                   reportId2,
      evidenceFileType:           'pdf',
      originalFileName:           'incident_documentation.pdf',
      fileSize:                   evidenceDocBuffer.length,
      mimeType:                   'application/pdf',
      cloudinaryPublicIdentifier: evidenceDocUpload.public_id,
      dynamicallySignedUrl:       evidenceDocUpload.secure_url
    });

    // ── Legal case A — fully drafted + document already generated ─────────
    // Lets the assigned legal counsel (+254700000030) click "Open Document"
    // and download a real PDF immediately, without generating one first.
    const legalCaseId2 = id();
    const legalCaseDraftA = {
      legalCaseId:         legalCaseId2,
      reportId:            reportId2,
      // The companion report is seeded at ESCALATED_TO_LEGAL_CASE; the real
      // ensureLegalCaseForWorkflow() (reportController.js) unconditionally
      // forces the case to READY_FOR_SUBMISSION on that transition, so
      // UNDER_INVESTIGATION here would be a status pairing the app can't produce.
      currentCaseStatus:   'READY_FOR_SUBMISSION',
      escalationTimestamp: daysAgo(25),
      caseSummary:
        'Survivor reported a sexual violence incident in Nairobi CBD on 2026-05-01. ' +
        'Medical attention was sought the same day. Survivor has been referred for ' +
        'ongoing counselling support and has consented to legal escalation.',
      legalGroundsText:
        'Sexual Offences Act (2006), Section 3 — defilement/sexual assault provisions. ' +
        'Penal Code Cap. 63 also considered for concurrent charges.',
      requestedReliefText:
        'Criminal prosecution referral to the Office of the Director of Public Prosecutions. ' +
        'Interim protection order requested pending investigation outcome.',
      recommendedActionsText:
        'Refer case file to DPP liaison desk. Coordinate forensic medical examination follow-up. ' +
        'Schedule survivor statement recording with assigned investigating officer.',
      draftLastUpdatedAt: daysAgo(20)
    };
    const legalDocBuffer = await buildLegalCasePdfBuffer(legalCaseDraftA, {
      reportId:      reportId2,
      category:      'sexual_violence',
      severityLevel: 'CRITICAL',
      date:          '2026-05-01',
      location:      'Nairobi, CBD'
    });
    const legalDocUpload = await uploadLegalDocumentBuffer({ buffer: legalDocBuffer, legalCaseId: legalCaseId2 });
    await LegalCaseFile.create({
      ...legalCaseDraftA,
      generatedDocumentPath: legalDocUpload.public_id,
      documentGeneratedAt:   daysAgo(19)
    });

    await IncidentReport.create({
      reportId:                reportId3,
      survivorId:              survivorIds[2],
      incidentCategory:        'stalking',
      severityLevel:           'MEDIUM',
      incidentDescriptionText: 'Ongoing stalking behaviour from a known individual.',
      incidentLocation:        'Mombasa, Old Town',
      incidentDate:            '2026-05-10',
      currentReportStatus:     'SUBMITTED',
      reportCreationTimestamp: daysAgo(21)
    });

    const extraReports = [
      {
        survivorId: survivorIds[3],
        incidentCategory: 'economic_abuse',
        severityLevel: 'LOW',
        incidentDescriptionText: 'Partner controls all income and denies household support.',
        incidentLocation: 'Kisumu, Nyamasaria',
        incidentDate: '2026-03-22',
        currentReportStatus: 'UNDER_REVIEW',
        reportCreationTimestamp: daysAgo(17)
      },
      {
        survivorId: survivorIds[4],
        incidentCategory: 'physical_violence',
        severityLevel: 'HIGH',
        incidentDescriptionText: 'Recent assault with repeated threats.',
        incidentLocation: 'Mombasa, Kisauni',
        incidentDate: '2026-05-18',
        currentReportStatus: 'ACTIVE_SUPPORT',
        reportCreationTimestamp: daysAgo(14)
      },
      {
        survivorId: survivorIds[0],
        incidentCategory: 'psychological_abuse',
        severityLevel: 'MEDIUM',
        incidentDescriptionText: 'Persistent intimidation and isolation from family support.',
        incidentLocation: 'Nairobi, Kasarani',
        incidentDate: '2026-02-14',
        currentReportStatus: 'RESOLVED',
        reportCreationTimestamp: daysAgo(10)
      },
      {
        survivorId: survivorIds[1],
        incidentCategory: 'digital_harassment',
        severityLevel: 'MEDIUM',
        incidentDescriptionText: 'Ongoing threats through social media and messaging apps.',
        incidentLocation: 'Nairobi, South B',
        incidentDate: '2026-04-03',
        currentReportStatus: 'UNDER_INVESTIGATION',
        reportCreationTimestamp: daysAgo(6)
      }
    ];

    for (const report of extraReports) {
      await IncidentReport.create({ reportId: id(), ...report });
    }

    // Kept separate (rather than inside extraReports) so its reportId can be
    // captured for a companion LegalCaseFile — this is Case B: an empty legal
    // case (no draft, no generated document) for testing the full manual
    // Save Draft → Generate Document → Open Document flow as legal counsel
    // +254700000031 (assigned to this Mombasa survivor).
    const legalReviewReportId = id();
    await IncidentReport.create({
      reportId:                legalReviewReportId,
      survivorId:              survivorIds[2],
      incidentCategory:        'child_protection',
      severityLevel:           'CRITICAL',
      incidentDescriptionText: 'Urgent child safety risk reported in household.',
      incidentLocation:        'Mombasa, Nyali',
      incidentDate:            '2026-05-21',
      currentReportStatus:     'LEGAL_REVIEW',
      reportCreationTimestamp: daysAgo(2)
    });

    await LegalCaseFile.create({
      legalCaseId:         id(),
      reportId:            legalReviewReportId,
      // The companion report is seeded at LEGAL_REVIEW; the real
      // ensureLegalCaseForWorkflow() (reportController.js) always corrects
      // OPEN -> UNDER_INVESTIGATION the moment a report enters LEGAL_REVIEW,
      // so a case left at OPEN here is a state the app can't produce.
      currentCaseStatus:   'UNDER_INVESTIGATION',
      escalationTimestamp: daysAgo(2)
    });

    const bulkReportTemplates = [
      { category: 'physical_violence',  severity: 'HIGH',     status: 'UNDER_REVIEW',         location: 'Nairobi, Embakasi' },
      { category: 'emotional_abuse',    severity: 'MEDIUM',   status: 'ACTIVE_SUPPORT',        location: 'Mombasa, Bamburi'  },
      { category: 'economic_abuse',     severity: 'LOW',      status: 'SUBMITTED',             location: 'Kisumu, Kondele'   },
      { category: 'digital_harassment', severity: 'MEDIUM',   status: 'UNDER_INVESTIGATION',   location: 'Nairobi, Kilimani' },
      { category: 'sexual_violence',    severity: 'CRITICAL', status: 'LEGAL_REVIEW',          location: 'Mombasa, Nyali'    },
      { category: 'child_protection',   severity: 'HIGH',     status: 'UNDER_REVIEW',          location: 'Kisumu, Mamboleo'  }
    ];

    // Dense activity around recent days for trend-chart visibility.
    const additionalReportDays = [28, 27, 24, 23, 20, 19, 16, 15, 12, 11, 8, 7, 5, 4, 3, 1];

    for (let i = 0; i < additionalReportDays.length; i += 1) {
      const template   = bulkReportTemplates[i % bulkReportTemplates.length];
      const survivorId = survivorIds[i % survivorIds.length];
      const bulkReportId = id();
      const bulkReportCreatedAt = daysAgo(additionalReportDays[i]);

      await IncidentReport.create({
        reportId: bulkReportId,
        survivorId,
        incidentCategory:        template.category,
        severityLevel:           template.severity,
        incidentDescriptionText: `Follow-up seeded case ${i + 1} for analytics visibility and dashboard testing.`,
        incidentLocation:        template.location,
        incidentDate:            new Date(Date.now() - (additionalReportDays[i] + 2) * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
        currentReportStatus:     template.status,
        reportCreationTimestamp: bulkReportCreatedAt
      });

      // Reports seeded directly into LEGAL_REVIEW bypass the
      // ensureLegalCaseForWorkflow() findOrCreate that the real status-update
      // endpoint runs on every transition into LEGAL_REVIEW — without this,
      // the report shows "Legal Review" with no LegalCaseFile behind it, so
      // legal counsel can never see the drafting panel for it.
      if (template.status === 'LEGAL_REVIEW') {
        await LegalCaseFile.create({
          legalCaseId:         id(),
          reportId:            bulkReportId,
          currentCaseStatus:   'UNDER_INVESTIGATION',
          escalationTimestamp: bulkReportCreatedAt
        });
      }
    }


    // ── 7. COMMUNITY ROOMS ───────────────────────────────────────────────

    console.log('🌱 Seeding community rooms...');

    const roomId1 = id();
    const roomId2 = id();

    await CommunityRoom.create({
      roomId:              roomId1,
      roomName:            'General Support Circle',
      roomDescriptionText: 'A safe space for survivors to share experiences and support each other.',
      createdByAdminId:    ngoAdminId1
    });

    await CommunityRoom.create({
      roomId:              roomId2,
      roomName:            'Legal Rights Awareness',
      roomDescriptionText: 'Resources and discussions around legal rights and the justice system.',
      createdByAdminId:    ngoAdminId2
    });

    // ── Room memberships: every user joins both rooms ────────────────────
    // Real postMessage() (communityController.js) findOrCreates a membership
    // before creating a message, so full enrollment is app-consistent and
    // guarantees every scripted sender below has a membership row. Joins are
    // staggered 31–35 days ago so they all precede the earliest message.
    const allUserIds = [
      ...survivorUserIds,
      ...counsellorUserIds,
      ...legalCounselUserIds,
      ngoAdminUserId1,
      ngoAdminUserId2,
      moderatorUserId1
    ];

    const membershipRows = [];
    for (const roomId of [roomId1, roomId2]) {
      allUserIds.forEach((userId, index) => {
        membershipRows.push({
          membershipId:  id(),
          roomId,
          userId,
          joinTimestamp: daysAgoAt(31 + (index % 5), 8 + (index % 10), (index * 13) % 60)
        });
      });
    }
    await RoomMembership.bulkCreate(membershipRows);

    /**
     * Resolves a compact sender key ('S3' = survivor[3], 'C1' = counsellor[1],
     * 'L2' = legal counsel[2], 'M0' = the moderator) to a UserAccount userId.
     * Keys keep the room scripts below readable at a glance.
     * @param {string} key
     * @returns {string} userId
     */
    const senderFor = (key) => {
      const index = Number(key.slice(1));
      if (key[0] === 'S') return survivorUserIds[index];
      if (key[0] === 'C') return counsellorUserIds[index];
      if (key[0] === 'L') return legalCounselUserIds[index];
      return moderatorUserId1;
    };

    /**
     * Bulk-creates a room's message timeline: messages start ~30 days ago and
     * walk forward with deterministic gaps sized so the last message lands
     * within roughly the last day — a dense, month-long, currently-active room.
     * @param {string} roomId
     * @param {Array<[string, string]>} script - [senderKey, messageText] pairs.
     * @returns {Promise<number>} Number of messages created.
     */
    async function seedRoomTimeline(roomId, script) {
      const spanMs = 29.5 * 24 * HOUR_MS;
      const averageGapMs = spanMs / script.length;
      let t = daysAgoAt(30, 9).getTime();

      const rows = script.map(([senderKey, text], index) => {
        // 0.6×–1.4× jitter around the average gap, deterministic per index.
        t += averageGapMs * (0.6 + ((index * 7) % 9) / 10);
        return {
          communityMessageId:       id(),
          roomId,
          senderUserId:             senderFor(senderKey),
          publicMessageContent:     text,
          messageDispatchTimestamp: new Date(Math.min(t, Date.now() - HOUR_MS))
        };
      });

      await CommunityMessage.bulkCreate(rows);
      return rows.length;
    }

    // ── Room 1: General Support Circle — peer support + counsellor guidance ──
    const generalSupportScript = [
      ['S0',  'Thank you for this space. It really helps to know others understand.'],
      ['S1',  'I found the legal resources here very helpful. Recommended!'],
      ['C0',  'Welcome to everyone who joined this week. This circle is yours — share as much or as little as you like, at your own pace.'],
      ['S5',  'First time posting here. I have been reading for days and finally felt brave enough to say hello.'],
      ['S2',  'Hello and welcome! Reading quietly counts too. We are glad you are here.'],
      ['S8',  'The hardest part for me was accepting that what happened was not my fault. Still working on it.'],
      ['C1',  'That self-blame is one of the most common wounds we see, and one of the most unfair. What happened to you was a choice someone else made.'],
      ['S13', 'Needed to read that today. Thank you.'],
      ['S0',  'Has anyone used the county safe-house referral process recently?'],
      ['S3',  'I went through it two months ago. The intake call was gentle and they moved fast. Ask your counsellor for the warm handover.'],
      ['S9',  'Seconding this. The shelter staff were kind and my children were welcomed too.'],
      ['S2',  'Breathing exercises helped me today. Sharing this in case it helps someone else.'],
      ['C2',  'For anyone new to it: try box breathing — in for 4, hold 4, out 4, hold 4. Even two minutes can lower the alarm in your body.'],
      ['S10', 'I tried the 5-4-3-2-1 grounding from the library workbook during a flashback yesterday. It actually brought me back.'],
      ['C0',  'So glad it helped. Grounding takes practice — the more you use it in calm moments, the better it works in hard ones.'],
      ['S6',  'Some days I feel strong and other days I can barely get out of bed. Is that normal?'],
      ['C3',  'Completely normal. Healing is not a straight line — a hard day after good ones is not a relapse, it is part of the path.'],
      ['S6',  'Thank you. I needed to hear that it is not just me.'],
      ['S15', 'It is definitely not just you. Tuesday I cried all day; today I cooked and laughed with my daughter.'],
      ['C1',  'Reminder: You can step away and come back later. Your pace matters.'],
      ['S3',  'Small steps forward still count. Today was hard but I am still here.'],
      ['S11', 'Still here too. That sentence carries me some weeks.'],
      ['S7',  'My family keeps telling me to go back and "work it out". How do you deal with the pressure?'],
      ['S1',  'I stopped explaining myself. I have one line I repeat: "I am doing what keeps me safe." Then I change the subject.'],
      ['S16', 'For me it helped to have one relative on my side who speaks up so I do not have to.'],
      ['C4',  'Both good strategies. You are allowed to protect your peace — you owe no one an explanation for choosing safety.'],
      ['M0',  'Gentle reminder of our community guidelines: no identifying details about yourself or others, and please report anything that feels unsafe using the flag button. This space stays safe because you keep it safe.'],
      ['S12', 'This room is honestly the reason I get through some evenings. Thank you all.'],
      ['S4',  'Same. I do not post often but I read everything.'],
      ['S17', 'Question — does anyone have tips for sleeping? My mind will not switch off at night.'],
      ['C2',  'A wind-down routine helps: screens off an hour before bed, a warm drink, and the breathing exercise. If thoughts race, keep a notebook by the bed and "park" them on paper.'],
      ['S17', 'Parking the thoughts on paper worked last night. Six hours straight for the first time in weeks!'],
      ['S9',  'That is wonderful! Celebrating every one of those six hours with you.'],
      ['S14', 'I have my first counselling session tomorrow and I am nervous. What should I expect?'],
      ['S5',  'Mine felt like talking to a patient friend. They let me set the pace and never pushed.'],
      ['C0',  'What they said. The first session is mostly about you feeling safe and deciding together what support looks like. You can pause or stop at any time.'],
      ['S14', 'Session done. I cried, but the good kind. Thank you both for the courage.'],
      ['S19', 'Rough evening here. Just needed to type that somewhere people understand.'],
      ['S8',  'We understand. Breathe. You made it through every hard evening so far — that is a 100% record.'],
      ['S19', 'A 100% record. I am writing that down. Thank you, friend.'],
      ['C3',  'Beautiful support in here tonight. Remember the crisis lines are there for the heaviest hours: 1195 is free and answers 24/7.'],
      ['S10', 'An update: I moved into my own small place this week. Two months ago I could not have imagined it.'],
      ['S2',  'This is the kind of news that keeps the rest of us going. Congratulations!'],
      ['S18', 'Amazing. May your new home be everything the old one was not.'],
      ['S10', 'Thank you both. It is small but it is mine, and it is quiet.'],
      ['S7',  'Went to the market alone today. First time in months. Small thing, big deal.'],
      ['C1',  'Not a small thing at all — that is courage in practice. Well done.'],
      ['S15', 'Does anyone else feel guilty on the days they feel happy? Like they have not "earned" it yet?'],
      ['C4',  'Yes, and hear this clearly: joy is not a betrayal of what you survived. Feeling happy is not forgetting — it is healing doing its work.'],
      ['S15', 'Saving this message. Thank you.'],
      ['S13', 'Checking in on everyone who had a hard week. You are seen.'],
      ['S6',  'Better this week. The good days are starting to outnumber the bad ones.'],
      ['S11', 'Grateful for this circle today and every day. Goodnight, everyone.'],
      ['C0',  'Goodnight all. Rest is also recovery. We will be here tomorrow.']
    ];

    // ── Room 2: Legal Rights Awareness — Q&A with legal counsel ──────────────
    const legalRightsScript = [
      ['L0',  'Welcome to Legal Rights Awareness. Ask anything about your rights, court processes, or documentation — no question is too basic, and nothing you ask here creates any obligation to act.'],
      ['S3',  'Can someone explain what happens after filing a police abstract?'],
      ['L1',  'An abstract is your proof that a report exists. After filing, the investigating officer takes over: statements are recorded, evidence is gathered, and the file may go to the ODPP for a charging decision. Keep your OB number safe — it is how you track the file.'],
      ['S3',  'Thank you. I did not know the OB number was that important.'],
      ['S0',  'The legal rights PDF in the library answered many of my questions.'],
      ['S4',  'I need guidance on obtaining protective orders.'],
      ['L0',  'Protection orders are covered by the Protection Against Domestic Violence Act (2015). You apply at a magistrate\'s court — no criminal case needed — and an interim order can be granted the same day. Your assigned legal counsel can prepare the application with you.'],
      ['S4',  'Same day? I always assumed it took months. Thank you.'],
      ['S1',  'Is there a template for documenting incidents for legal purposes?'],
      ['L2',  'Yes — the Safety Planning section of the library has one. The essentials: date, time, place, what happened, any injuries, any witnesses. Consistent, dated entries carry real weight in court.'],
      ['S9',  'What is a P3 form exactly? The hospital mentioned it but everything happened so fast.'],
      ['L1',  'The P3 is the official medical examination form used as evidence of injury. It is issued free at public facilities, filled by an authorised medical officer, and links your injuries to a date. There is a step-by-step guide to it in the library.'],
      ['S9',  'Found the guide. Much clearer now, thank you.'],
      ['S11', 'If I report and then change my mind, can I withdraw?'],
      ['L3',  'You can withdraw your complaint, though for serious offences the ODPP technically decides whether prosecution continues. Practically: withdrawing is your right, and no one on this platform will ever pressure you either way. Your report here can also simply be marked withdrawn.'],
      ['S11', 'That takes a weight off. I want to keep my options open without being locked in.'],
      ['L3',  'Exactly what the process allows. Documenting now preserves choices for later — it never removes them.'],
      ['S6',  'Does it cost money to get legal help? I cannot afford a lawyer.'],
      ['L4',  'Legal support through this platform is free — it is part of the NGO\'s service. Beyond us, the National Legal Aid Service and FIDA Kenya also provide free representation for GBV matters. Cost should never be the reason you go unrepresented.'],
      ['S6',  'I honestly thought lawyers were only for people with money. Thank you for this.'],
      ['S13', 'What does "in camera" mean? My counsellor said I could ask for it.'],
      ['L0',  'It means the court hearing is closed to the public — only the parties and court officers present. GBV survivors can request it so testimony stays private. The court also allows testimony via intermediaries or screens in sensitive cases.'],
      ['S13', 'That makes the idea of testifying much less terrifying.'],
      ['S16', 'My employer found out about my case and is treating me differently. Is that allowed?'],
      ['L2',  'No. The Employment Act protects you from discrimination, and if the case involves workplace harassment there are additional protections. Document every incident of the different treatment — dates and specifics — and raise it with your assigned counsel.'],
      ['S16', 'Started a log today. Thank you.'],
      ['M0',  'A reminder for this room: please keep questions general and save case-specific details for your private legal chat — it protects your case and your privacy.'],
      ['S7',  'General question then: how long do cases like these usually take in court?'],
      ['L1',  'Honestly: months to a few years depending on complexity and court backlog. But protection orders are fast, and many protective steps do not wait for the main case. Your safety is never on hold while a case runs.'],
      ['S10', 'Can a protection order cover my children too?'],
      ['L4',  'Yes. Children can be named in the order, and the Children Act (2022) puts their best interests first in any related custody question. Ask your counsel to include them when drafting.'],
      ['S10', 'Asked mine this morning. Thank you for confirming.'],
      ['S18', 'What if the police do not act on my report? It has been weeks of silence.'],
      ['L3',  'You have options: a formal follow-up letter citing your OB number usually restarts a file, and beyond that IPOA exists precisely for inaction complaints. Raise it in your legal chat — a counsel\'s letter tends to move things.'],
      ['S18', 'Message sent to my counsel. I did not know silence was something you could escalate.'],
      ['S2',  'Sharing for anyone afraid of reporting: I finally did it last month. It was hard but the gender desk officer was kind, and having my documentation ready made it quick.'],
      ['L0',  'Thank you for sharing that. Preparation makes an enormous difference — abstract, P3, and a dated incident log are the strongest start any case can have.'],
      ['S14', 'Is what I tell my counsellor confidential if a case goes to court?'],
      ['L2',  'Counselling records have strong confidentiality protections and are not simply handed over. Anything shared with your legal counsel is privileged. If a court ever sought records, you would be informed and represented — nothing moves behind your back.'],
      ['S14', 'That was my biggest fear about opening up. Asking my counsellor felt safer already.'],
      ['S5',  'The court checklist PDF in the library is excellent — I printed it and tick things off as they happen. Highly recommend.'],
      ['S19', 'Do I need to attend every court date myself?'],
      ['L1',  'Not every one — many mentions are procedural and your counsel attends for you. You will be told clearly in advance which dates need you personally, and support is arranged for those.'],
      ['S19', 'Good to know. The idea of endless court trips was putting me off entirely.'],
      ['S12', 'Just wanted to say this room has replaced so much fear with facts. Thank you to the counsel who answer here.'],
      ['L4',  'That is exactly what this room is for. Knowledge is protection. Keep the questions coming.'],
      ['S8',  'Last one from me tonight: where do I start if I have never done any of this? Step one?'],
      ['L0',  'Step one is exactly where you are: talk to your assigned counsel in your private legal chat. We map your situation, your options, and your pace — nothing is filed until you say so.']
    ];

    const room1MessageCount = await seedRoomTimeline(roomId1, generalSupportScript);
    const room2MessageCount = await seedRoomTimeline(roomId2, legalRightsScript);
    const communityMessageCount = room1MessageCount + room2MessageCount;

    // Flagged message #1 — for moderation queue testing
    const flaggedMsgId1 = id();
    await CommunityMessage.create({
      communityMessageId:   flaggedMsgId1,
      roomId:               roomId1,
      senderUserId:         survivorUserIds[2],
      publicMessageContent: '[Test message flagged for moderation review]'
    });
    await HarmfulContentReport.create({
      contentReportId:            id(),
      reportedCommunityMessageId: flaggedMsgId1,
      reporterUserId:             survivorUserIds[0],
      reportReasonText:           'This content felt inappropriate for this space.',
      moderationReviewStatus:     'PENDING'
    });

    // Flagged message #2 — second moderation case for queue depth testing
    const flaggedMsgId2 = id();
    await CommunityMessage.create({
      communityMessageId:   flaggedMsgId2,
      roomId:               roomId2,
      senderUserId:         survivorUserIds[4],
      publicMessageContent: '[Second test message flagged for moderation review]'
    });
    await HarmfulContentReport.create({
      contentReportId:            id(),
      reportedCommunityMessageId: flaggedMsgId2,
      reporterUserId:             survivorUserIds[3],
      reportReasonText:           'Message made me feel unsafe.',
      moderationReviewStatus:     'PENDING'
    });

    // Moderation warning for flagged message #1
    await ModerationActionLog.create({
      moderationActionId:     id(),
      moderatorUserId:        ngoAdminUserId1,
      targetUserId:           survivorUserIds[2],
      moderationActionType:   'WARNING',
      moderationActionReason: 'Community guidelines reminder issued to user.'
    });


    // ── 8. DIRECT CHAT CHANNELS AND MESSAGES ────────────────────────────

    console.log('🌱 Seeding direct chat channels and messages...');

    /**
     * Provision one counsellor_channel and one legal_counsel_channel per survivor.
     * In production these are created by ensureAutoChannelsForSurvivor.
     * The seeder provisions them explicitly so the DB is fully usable without a
     * prior server run.
     *
     * Special channel statuses for UI feature testing:
     *   Survivor[2]↔counsellor  → "archived"  (Archive/Restore UI flow)
     *   Survivor[3]↔legal        → "deleted"   (Trash/Restore UI flow, Item 2)
     */
    const seededChannels = [];
    let directMessageCount = 0;

    for (let i = 0; i < survivorIds.length; i++) {
      const assignment = survivorAssignments[i];

      // Rotate the scripted conversations so channels don't read copy-pasted;
      // script [0] (the longest) lands on the primary demo pair (i === 0).
      // The last message lands 2h ago for the demo survivor and 6–90h ago
      // for the rest, so channel lists sort with believable recency.
      const counsellorScript = COUNSELLOR_SCRIPTS[i % COUNSELLOR_SCRIPTS.length];
      const legalScript      = LEGAL_SCRIPTS[i % LEGAL_SCRIPTS.length];
      const lastActivityHoursAgo = i === 0 ? 2 : 6 + (i % 5) * 21;

      const counsellorChannelStatus = (i === 2) ? 'archived' : 'active';
      const legalChannelStatus      = (i === 3) ? 'deleted'  : 'active';

      // ── Counsellor channel ─────────────────────────────────────────────
      const counsellorChatId = id();
      await DirectChatChannel.create({
        chatId:                    counsellorChatId,
        survivorId:                assignment.survivorId,
        supportStaffCounterpartId: assignment.counsellorUserId,
        chatChannelType:           'counsellor_channel',
        chatChannelStatus:         counsellorChannelStatus
      });
      seededChannels.push({
        chatId:      counsellorChatId,
        survivorId:  assignment.survivorId,
        channelType: 'counsellor_channel',
        staffUserId: assignment.counsellorUserId,
        status:      counsellorChannelStatus
      });

      // Archived channels keep an older, fully-read farewell thread (archive
      // preserves history); active channels get a full scripted conversation.
      directMessageCount += await seedDirectConversation({
        chatId:         counsellorChatId,
        survivorUserId: survivorUserIds[i],
        staffUserId:    assignment.counsellorUserId,
        script:         counsellorChannelStatus === 'active' ? counsellorScript : ARCHIVED_CHANNEL_SCRIPT,
        lastMessageHoursAgo: counsellorChannelStatus === 'active' ? lastActivityHoursAgo : 14 * 24
      });

      // ── Legal counsel channel ──────────────────────────────────────────
      const legalChatId = id();
      await DirectChatChannel.create({
        chatId:                    legalChatId,
        survivorId:                assignment.survivorId,
        supportStaffCounterpartId: assignment.legalCounselUserId,
        chatChannelType:           'legal_counsel_channel',
        chatChannelStatus:         legalChannelStatus
      });
      seededChannels.push({
        chatId:      legalChatId,
        survivorId:  assignment.survivorId,
        channelType: 'legal_counsel_channel',
        staffUserId: assignment.legalCounselUserId,
        status:      legalChannelStatus
      });

      // Deleted channels keep the paused-process thread so the survivor's
      // Trash → Restore flow brings real history back, not an empty room.
      directMessageCount += await seedDirectConversation({
        chatId:         legalChatId,
        survivorUserId: survivorUserIds[i],
        staffUserId:    assignment.legalCounselUserId,
        script:         legalChannelStatus === 'active' ? legalScript : DELETED_CHANNEL_SCRIPT,
        lastMessageHoursAgo: legalChannelStatus === 'active' ? lastActivityHoursAgo + 3 : 21 * 24
      });
    }


    // ── 9. DATA INTEGRITY GUARD ──────────────────────────────────────────

    console.log('🔍 Running post-seed data integrity checks...');

    /**
     * Assert every survivor has exactly one counsellor_channel and one
     * legal_counsel_channel, and each points to the assigned staff member.
     * Fails loudly on any broken link so problems surface at seed time.
     */
    for (let i = 0; i < survivorIds.length; i++) {
      const assignment = survivorAssignments[i];
      const survivorChannels = seededChannels.filter(c => c.survivorId === assignment.survivorId);

      const counsellorChannels   = survivorChannels.filter(c => c.channelType === 'counsellor_channel');
      const legalCounselChannels = survivorChannels.filter(c => c.channelType === 'legal_counsel_channel');

      if (counsellorChannels.length !== 1) {
        throw new Error(
          `Seed integrity check failed: survivor[${i}] (${assignment.survivorId}) ` +
          `has ${counsellorChannels.length} counsellor_channel(s); expected 1.`
        );
      }
      if (legalCounselChannels.length !== 1) {
        throw new Error(
          `Seed integrity check failed: survivor[${i}] (${assignment.survivorId}) ` +
          `has ${legalCounselChannels.length} legal_counsel_channel(s); expected 1.`
        );
      }

      // Verify channel → assignment link (catches mismatched userIds).
      if (counsellorChannels[0].staffUserId !== assignment.counsellorUserId) {
        throw new Error(
          `Seed assignment-link check failed: survivor[${i}] counsellor channel ` +
          `points to ${counsellorChannels[0].staffUserId} but assigned userId is ${assignment.counsellorUserId}.`
        );
      }
      if (legalCounselChannels[0].staffUserId !== assignment.legalCounselUserId) {
        throw new Error(
          `Seed assignment-link check failed: survivor[${i}] legal_counsel channel ` +
          `points to ${legalCounselChannels[0].staffUserId} but assigned userId is ${assignment.legalCounselUserId}.`
        );
      }
    }

    console.log('✅ Integrity checks passed: all survivors have correct counsellor and legal-counsel channels.');


    // ── 10. NOTIFICATIONS ─────────────────────────────────────────────────

    console.log('🌱 Seeding notifications...');

    /**
     * All notification messages use discreet wording per SSD §22.2.
     * No mention of GBV, counselling, or the platform's purpose.
     */
    await InAppNotification.create({
      notificationId:              id(),
      recipientUserId:             survivorUserIds[0],
      notificationCategoryType:    'NEW_MESSAGE',
      discreetNotificationMessage: 'You have a new message.',
      notificationReadStatus:      'UNREAD'
    });
    await InAppNotification.create({
      notificationId:              id(),
      recipientUserId:             survivorUserIds[1],
      notificationCategoryType:    'REPORT_UPDATE',
      discreetNotificationMessage: 'Your request has been updated.',
      notificationReadStatus:      'READ'
    });
    await InAppNotification.create({
      notificationId:              id(),
      recipientUserId:             counsellorUserIds[0],
      notificationCategoryType:    'ASSIGNMENT',
      discreetNotificationMessage: 'A new assignment has been made.',
      notificationReadStatus:      'READ'
    });
    await InAppNotification.create({
      notificationId:              id(),
      recipientUserId:             ngoAdminUserId1,
      notificationCategoryType:    'MODERATION_ALERT',
      discreetNotificationMessage: 'A moderation alert requires review.',
      notificationReadStatus:      'UNREAD'
    });
    await InAppNotification.create({
      notificationId:              id(),
      recipientUserId:             survivorUserIds[2],
      notificationCategoryType:    'NEW_MESSAGE',
      discreetNotificationMessage: 'You have a new message.',
      notificationReadStatus:      'UNREAD'
    });


    // ── 11. SUPPORT RESOURCES ─────────────────────────────────────────────

    console.log('🌱 Seeding support resources...');

    // Two genuinely educational documents per category. Each renders as a
    // structured multi-page PDF (buildResourcePdfBuffer) so downloads from
    // the library are real sample materials, not one-paragraph placeholders.
    const resources = [
      {
        title: 'GBV Emergency Hotlines — Kenya (24/7 Directory)',
        category: 'emergency_hotlines',
        desc: 'A verified directory of 24/7 emergency hotlines for GBV survivors in Kenya, with guidance on what each line offers.',
        subtitle: 'Toll-free crisis, medical, police, and legal-aid lines — keep this list somewhere safe.',
        sections: [
          { heading: 'How to use this directory',
            paragraphs: [
              'Every line listed here is answered by trained responders. You do not need money, airtime for toll-free numbers, or any documents to call. You may remain anonymous, and you decide how much to share.',
              'If you are in immediate physical danger, call the police first (999, 112, or 911), then a support line once you are safe.'
            ] },
          { heading: 'National toll-free crisis lines',
            contacts: [
              { name: '1195 — National GBV Helpline (HAK)', detail: 'Free, 24/7. Crisis counselling, safety guidance, and referrals to shelter, medical, and legal services countrywide. Operated by Healthcare Assistance Kenya.' },
              { name: '116 — Childline Kenya', detail: 'Free, 24/7. For children and anyone reporting harm to a child. Case workers coordinate with the Department of Children\'s Services.' },
              { name: '999 / 112 / 911 — Kenya Police Emergency', detail: 'Free, 24/7. Ask for the gender desk when reporting GBV; every major station has one.' },
              { name: '1190 — LVCT Health One2One', detail: 'Free, 24/7. Confidential counselling on sexual health and violence, youth-friendly.' }
            ] },
          { heading: 'Medical care and recovery centres',
            paragraphs: [
              'After physical or sexual violence, seek medical care within 72 hours if possible — both for your health (including PEP to prevent HIV, and emergency contraception) and so that medical evidence can be documented on the PRC and P3 forms, free of charge at public facilities.'
            ],
            contacts: [
              { name: 'Gender Violence Recovery Centre (GVRC), Nairobi Women\'s Hospital', detail: '+254 719 638 006. Free, comprehensive medical and psychosocial care for survivors, 24/7.' },
              { name: 'GBVRC, Kenyatta National Hospital', detail: 'Via KNH main line +254 20 2726300. Public referral centre with specialised clinicians.' },
              { name: 'GBVRC, Coast General Teaching & Referral Hospital (Mombasa)', detail: 'Walk-in, 24/7 through the casualty department.' }
            ] },
          { heading: 'Free legal aid lines',
            contacts: [
              { name: 'FIDA Kenya (Federation of Women Lawyers)', detail: '+254 20 3874938 / toll-free 0800 720 501. Free legal advice and representation for women and girls.' },
              { name: 'National Legal Aid Service (NLAS)', detail: 'Via Huduma Centres or +254 20 2227461. State-funded legal aid for those who cannot afford counsel.' },
              { name: 'CREAW Kenya', detail: '0800 720 186 (toll-free). Legal aid and rapid-response support for GBV survivors.' }
            ] },
          { heading: 'What to expect when you call',
            bullets: [
              'A trained responder will listen without judgement — you set the pace and may stop at any time.',
              'You will be asked whether you are currently safe; answer as freely as your situation allows.',
              'With your consent, the responder can refer you to shelter, medical care, counselling, or legal aid near you.',
              'Calls to the lines above are confidential. Toll-free lines do not appear on most itemised bills, but clear your call log if your phone may be checked.'
            ] },
          { heading: 'If you cannot speak safely',
            paragraphs: [
              'If a call is unsafe, this platform\'s USSD channel works on any phone without internet and leaves no app trace. You can also request a callback at a time you choose, or use the in-app reporting form which is protected by a quick-exit button.'
            ] }
        ]
      },
      {
        title: 'When and How to Call for Help — A Quick Guide',
        category: 'emergency_hotlines',
        desc: 'Practical guidance on deciding to call, staying safe while calling, and what happens after you reach out.',
        subtitle: 'You do not have to be in crisis for the call to be worth making.',
        sections: [
          { heading: 'Deciding to call',
            paragraphs: [
              'Many survivors wait, wondering whether their situation is "serious enough". If you are asking that question, the call is already worth making. Helplines exist for uncertainty as much as for emergencies — for the day you want to understand your options, not only the day you need rescue.'
            ],
            bullets: [
              'Call 999/112 if you or someone else is in immediate danger.',
              'Call 1195 to talk through your situation, plan for safety, or find services.',
              'Call 116 for anything involving a child\'s safety.'
            ] },
          { heading: 'Before you dial — a 30-second safety check',
            bullets: [
              'Is anyone within earshot who should not hear this call? If so, consider stepping out, using text-based options, or the USSD channel.',
              'Is your phone likely to be checked? Memorise or disguise the number (save 1195 under a neutral name) and clear the call log afterwards.',
              'If interrupted, have a cover line ready — e.g. asking about a clinic appointment.'
            ] },
          { heading: 'What information helps (none of it is required)',
            bullets: [
              'Your first name or any name you choose to use.',
              'Your general location (county or town) so referrals are nearby.',
              'Whether you are currently safe, and whether children are involved.',
              'What kind of help you are looking for today — even "I do not know" is a fine answer.'
            ] },
          { heading: 'After the call',
            paragraphs: [
              'Write down (somewhere safe) any referral names, numbers, or case codes you were given. If you agreed to a callback, keep your phone reachable at the agreed time — and if plans change, that is okay; you can always call again.',
              'Reaching out once does not commit you to anything. You remain in control of every next step, including doing nothing further for now.'
            ] },
          { heading: 'No airtime, no smartphone, no privacy?',
            bullets: [
              'Toll-free lines (1195, 116, 1190, 0800-numbers) cost nothing from any Kenyan network.',
              'This platform\'s USSD menu works on the most basic phone with no internet.',
              'Huduma Centres and public hospitals can connect you to services in person.',
              'A trusted friend can call on your behalf to gather information first.'
            ] }
        ]
      },
      {
        title: 'Know Your Legal Rights: GBV and the Law in Kenya',
        category: 'legal_guidance',
        desc: 'A plain-language guide to the laws that protect GBV survivors in Kenya and the rights they guarantee.',
        subtitle: 'The Protection Against Domestic Violence Act, the Sexual Offences Act, and your Constitution — explained simply.',
        sections: [
          { heading: 'Your constitutional foundation',
            paragraphs: [
              'Article 29 of the Constitution of Kenya (2010) guarantees every person freedom and security, including the right to be free from any form of violence from public or private sources. Violence in a home is not a "private matter" — it is a violation of a constitutional right, and the State has a duty to protect you.'
            ] },
          { heading: 'The Protection Against Domestic Violence Act (2015)',
            paragraphs: [
              'The PADV Act protects people from violence by family members, spouses, former spouses, and people in domestic relationships. Its definition of violence is deliberately wide.'
            ],
            bullets: [
              'Covers physical, sexual, psychological, and economic abuse, as well as harassment, intimidation, stalking, and damage to property.',
              'Lets you apply to a magistrate\'s court for a protection order — no criminal case is required.',
              'Interim protection orders can be granted the same day, without the other party present (ex parte), where there is risk.',
              'Breaching a protection order is itself a criminal offence — police can arrest on the breach alone.'
            ] },
          { heading: 'The Sexual Offences Act (2006)',
            bullets: [
              'Defines and criminalises rape, defilement, sexual assault, sexual harassment, and related offences, with minimum sentences.',
              'Provides for free medical treatment and examination of survivors at public facilities.',
              'Allows vulnerable witnesses to testify through intermediaries or protective measures such as screens.',
              'Your sexual history is not admissible to discredit you except in narrowly defined circumstances.'
            ] },
          { heading: 'Rights you hold throughout the process',
            bullets: [
              'The right to report at any police station and receive an OB number — refusal to record your report can be escalated.',
              'The right to free P3 and PRC forms at public health facilities.',
              'The right to request closed (in camera) court proceedings to protect your privacy.',
              'The right to free legal aid through the National Legal Aid Service (Legal Aid Act, 2016) and organisations such as FIDA Kenya.',
              'The right to withdraw from counselling or platform services at any time — support is never conditional on prosecuting.'
            ] },
          { heading: 'Common myths, corrected',
            bullets: [
              '"You cannot report a spouse." — False. Marriage is not a defence to assault or sexual offences.',
              '"You need a lawyer to get a protection order." — False. You may apply in person, though free counsel makes it easier.',
              '"Withdrawing a case means you were lying." — False. Withdrawal is a right, and your safety decisions are yours.',
              '"Reporting always means court." — False. Documentation preserves options; it does not force any of them.'
            ] }
        ]
      },
      {
        title: 'The P3 Form and Medical Evidence — Step by Step',
        category: 'legal_guidance',
        desc: 'What the P3 and PRC forms are, where to get them free of charge, and how medical evidence supports a case.',
        subtitle: 'A practical walkthrough of Kenya\'s medical-evidence process for GBV cases.',
        sections: [
          { heading: 'The two forms, in one minute',
            bullets: [
              'PRC form (Post-Rape Care, MOH 363) — completed at the health facility during treatment after sexual violence. It records medical findings and care given. Free at public facilities.',
              'P3 form — the police medical examination form used for any assault. It links injuries to a date and is the document courts rely on. Issued by police, completed by an authorised clinician, free of charge.'
            ] },
          { heading: 'The sequence that protects both health and evidence',
            bullets: [
              'Seek medical care first — within 72 hours after sexual violence if at all possible, for PEP (HIV prevention) and emergency contraception.',
              'Ask the facility to complete the PRC form during treatment; you should receive a copy.',
              'Report at any police station and ask for the OB number and a P3 form.',
              'Return to a public health facility (or the police surgeon) to have the P3 completed and signed.',
              'Return the completed P3 to the investigating officer, and keep a copy or photograph of every page.'
            ] },
          { heading: 'Practical answers to common worries',
            bullets: [
              '"I washed / changed clothes — is it too late?" No. Evidence value is highest early, but injuries, records, and your account still matter days or weeks later.',
              '"I was treated but never reported." Your medical records still exist and can support a case whenever you choose to report.',
              '"The police asked me to pay for the P3." The form is free by law. Ask for the officer in charge, or raise it with your legal counsel — this is a known malpractice.',
              '"The clinic is far / I have no money." Public facilities complete these forms at no cost, and your counsellor can help arrange transport support where available.'
            ] },
          { heading: 'Keeping your own evidence file',
            bullets: [
              'A dated log of every incident: date, time, place, what happened, injuries, witnesses.',
              'Photographs of injuries with dates (many phones stamp these automatically).',
              'Copies or photos of the OB entry, P3, PRC, and any treatment notes.',
              'Threatening messages preserved in their original form, backed up somewhere the other party cannot reach.'
            ] },
          { heading: 'How this platform helps',
            paragraphs: [
              'Evidence uploaded to your report here is stored privately and is visible only to your assigned support team. Your legal counsel can review your documents, chase a stalled P3 with the station, and prepare certified copies for court — ask in your legal chat.'
            ] }
        ]
      },
      {
        title: 'Safe Shelter Guide — What to Expect',
        category: 'shelters',
        desc: 'How safe houses work in Kenya: referral, intake, daily life, children, and moving on — with regional contacts.',
        subtitle: 'Nairobi · Mombasa · Kisumu · Nakuru · Eldoret referral regions',
        sections: [
          { heading: 'What a safe house is (and is not)',
            paragraphs: [
              'A safe house is a confidential, temporary residence for people fleeing violence. Locations are not published; access is by referral so that the address stays protected for everyone inside.',
              'It is not a detention facility and not a last resort for the destitute only — survivors from every background use shelters as a bridge to a safer arrangement.'
            ] },
          { heading: 'How referral works on this platform',
            bullets: [
              'Tell your assigned counsellor you want shelter, or call 1195 if you need it outside platform hours.',
              'A brief safety assessment follows — your risk level, children, medical needs, and location.',
              'The counsellor makes a warm handover to a vetted shelter with space; you receive the meeting point and intake time, not a public address.',
              'Emergency placements can happen the same day when risk is high.'
            ] },
          { heading: 'What shelters provide',
            bullets: [
              'Secure accommodation, meals, and basic supplies — usually for 2 weeks to 3 months depending on the facility and your plan.',
              'On-site or linked counselling and group support.',
              'Help with legal processes: accompaniment to court or the police station, and liaison with your legal counsel.',
              'Children stay with you; school continuity is arranged where possible.',
              'Reintegration planning: income support options, family mediation only where you want it, and safe housing next steps.'
            ] },
          { heading: 'What to bring if you can (nothing is mandatory)',
            bullets: [
              'ID card and children\'s birth certificates or clinic cards.',
              'Any medication, and your medical or court documents.',
              'Phone and charger; a little cash if available.',
              'A few clothes for you and the children — shelters can supply the rest.'
            ] },
          { heading: 'Regional referral contacts',
            contacts: [
              { name: 'Nairobi region', detail: 'Referral via your counsellor, GVRC (+254 719 638 006), or the 1195 helpline.' },
              { name: 'Coast region (Mombasa, Kilifi)', detail: 'Referral via 1195 or the county gender office; Coast General GBVRC can hold urgent cases pending placement.' },
              { name: 'Nyanza (Kisumu)', detail: 'Referral via 1195; county gender desk at Prosperity House processes shelter requests on weekdays.' },
              { name: 'Rift Valley (Nakuru, Eldoret)', detail: 'Referral via 1195 or the county Department of Gender; several faith-based shelters accept vetted referrals.' }
            ] }
        ]
      },
      {
        title: 'Preparing to Leave — Shelter Readiness Checklist',
        category: 'shelters',
        desc: 'A discreet, step-by-step checklist for preparing to leave an unsafe home, including documents, money, children, and digital safety.',
        subtitle: 'Prepare quietly, at your own pace. Leaving is a process, not a single moment.',
        sections: [
          { heading: 'First: a word on timing',
            paragraphs: [
              'The days around leaving can be the most dangerous period in an abusive relationship. Prepare quietly, tell only people you fully trust, and let your counsellor help you time the move — especially if threats have escalated recently.'
            ] },
          { heading: 'Documents (originals if safe, photos otherwise)',
            bullets: [
              'National ID or passport; children\'s birth certificates and clinic cards.',
              'NHIF/SHA card, bank cards, M-Pesa SIM.',
              'School documents for the children.',
              'Any court, police (OB number), or medical documents.',
              'Title deeds, tenancy agreements, or pay slips if relevant to later legal steps.'
            ] },
          { heading: 'The emergency bag',
            paragraphs: [
              'Pack one small bag and keep it where it raises no questions — at a trusted neighbour\'s, at work, or under ordinary items. If a packed bag is too risky, keep a written list so you can pack in five minutes.'
            ],
            bullets: [
              'Change of clothes for you and the children; essential medication.',
              'Phone charger; some cash in small notes.',
              'Spare keys (house and car).',
              'Small comfort item for each child.'
            ] },
          { heading: 'Money and phone, quietly',
            bullets: [
              'If possible, set aside small amounts over time in an account or M-Pesa line the other person does not know about.',
              'Check your phone for shared accounts, linked location, or family-tracking apps — the Digital Safety guide in this library walks through each setting.',
              'Memorise two key numbers in case you must leave the phone behind: one trusted person, and 1195.'
            ] },
          { heading: 'The children',
            bullets: [
              'Teach them one simple plan: where to go in the house when things get frightening, and which neighbour to run to.',
              'Agree a code word that means "we are leaving now" without alarming them.',
              'Do not tell young children the plan in advance — carrying the secret is a burden and a risk.'
            ] },
          { heading: 'On the day',
            bullets: [
              'Leave at a time the other person is reliably away; do not announce the departure.',
              'Go directly to the agreed meeting point — not to relatives the other person will check first.',
              'Once safe, tell your counsellor you have moved so support and any legal protections follow you.'
            ] }
        ]
      },
      {
        title: 'Healing After Trauma — A Self-Care Workbook',
        category: 'self_help',
        desc: 'Understanding common trauma responses, with evidence-based exercises: grounding, breathing, journaling, and sleep care.',
        subtitle: 'Not a substitute for counselling — a companion to it, for the hours between sessions.',
        sections: [
          { heading: 'Your reactions are normal responses to abnormal events',
            paragraphs: [
              'After violence, many people experience flashbacks, jumpiness, trouble sleeping, numbness, shame, anger, or waves of grief. These are not weakness and not "going mad" — they are a nervous system doing exactly what it was built to do after danger, and they ease with time and support.'
            ],
            bullets: [
              'Hypervigilance — feeling constantly on guard, startling easily.',
              'Intrusion — unwanted memories, nightmares, flashbacks.',
              'Avoidance — steering around places, people, or feelings connected to what happened.',
              'Mood shifts — guilt, self-blame, hopelessness, irritability, or feeling flat.'
            ] },
          { heading: 'Grounding: the 5-4-3-2-1 exercise',
            paragraphs: [
              'When a memory or panic pulls you out of the present, grounding brings you back through your senses. Slowly name:'
            ],
            bullets: [
              '5 things you can SEE around you,',
              '4 things you can TOUCH (touch them as you name them),',
              '3 things you can HEAR,',
              '2 things you can SMELL,',
              '1 thing you can TASTE.'
            ] },
          { heading: 'Breathing: the 4-4-4 box',
            bullets: [
              'Breathe in through the nose for a slow count of 4.',
              'Hold gently for 4.',
              'Breathe out through the mouth for 4, and hold 4 again.',
              'Repeat for 2–3 minutes. Longer out-breaths signal safety to the body — this works with your biology, not against it.'
            ] },
          { heading: 'Journaling prompts (private, no rules)',
            bullets: [
              'One thing I did well today was…',
              'Right now my body feels… and what it might need is…',
              'A person, place, or memory that still feels safe is…',
              'If my closest friend had been through what I have, I would tell them…',
              'Something I am looking forward to, however small, is…'
            ] },
          { heading: 'Sleep care',
            bullets: [
              'Keep a steady wake-up time, even after bad nights — it anchors the body clock.',
              'Screens off an hour before bed; the light and the scrolling both keep the alarm system awake.',
              'If your mind races, "park" the thoughts in a notebook by the bed and return to the breath.',
              'Nightmares often reduce as daytime processing (counselling) progresses — tell your counsellor about them.'
            ] },
          { heading: 'When to reach for more support',
            paragraphs: [
              'If distress is not easing after several weeks, if you are using alcohol or other substances to cope, or if you have thoughts of harming yourself — tell your counsellor now, or call 1195 any hour. More support at the right moment is strength, not failure.'
            ] }
        ]
      },
      {
        title: 'Grounding Techniques for Difficult Moments',
        category: 'self_help',
        desc: 'A pocket guide of fast, body-based techniques for flashbacks, panic, and overwhelming moments.',
        subtitle: 'Short enough to remember. Effective enough to matter.',
        sections: [
          { heading: 'Why grounding works',
            paragraphs: [
              'A flashback or panic surge happens when the brain\'s alarm system fires as if the danger were happening now. Grounding techniques feed the brain strong, present-moment sensory information — evidence that you are here, now, and safe — which lets the alarm stand down.'
            ] },
          { heading: 'Body-first techniques (fastest in a crisis)',
            bullets: [
              'Press your feet firmly into the floor and notice the pressure. Say to yourself: "It is [day], I am in [place], and I am safe right now."',
              'Hold something cold — a cold drink, cool water on the wrists and face.',
              'Push your palms together hard for ten seconds, then release. Repeat three times.',
              'Name the room: walls, door, window, five objects. Out loud if you can.'
            ] },
          { heading: 'The 5-4-3-2-1 sweep',
            paragraphs: [
              'Name 5 things you can see, 4 you can touch, 3 you can hear, 2 you can smell, 1 you can taste. Go slowly; touching the items as you name them doubles the effect.'
            ] },
          { heading: 'Breath patterns',
            bullets: [
              'Box breathing: in 4 — hold 4 — out 4 — hold 4, for two minutes.',
              'Long exhale: in for 4, out for 8. The extended out-breath activates the body\'s calming response.',
              'If counting is hard mid-panic, just make each out-breath slower than the in-breath.'
            ] },
          { heading: 'Safe-place visualisation (practise when calm)',
            paragraphs: [
              'Build one place in your mind — real or imagined — in full sensory detail: what you see, hear, smell, and feel there. Practise visiting it daily when calm. A well-rehearsed safe place becomes reachable even in hard moments.'
            ] },
          { heading: 'Make a coping card',
            bullets: [
              'On a small card or a phone note, write: your three fastest techniques, one sentence that steadies you, and two numbers (a trusted person, and 1195).',
              'Keep it where your hands will find it in a bad moment — wallet, phone case, bedside.',
              'Review it monthly with your counsellor and update what works.'
            ] }
        ]
      },
      {
        title: 'Personal Safety Plan — Template and Guide',
        category: 'safety_planning',
        desc: 'A complete personal safety-plan template: home safety, code words, emergency contacts, exit routes, and children\'s planning.',
        subtitle: 'A safety plan turns fear into steps. Fill it in privately, review it monthly.',
        sections: [
          { heading: 'What a safety plan is',
            paragraphs: [
              'A safety plan is a set of decisions made in calm moments so they do not have to be invented in dangerous ones: where to go, whom to call, what to grab, what the children should do. Write yours somewhere the other person will not find it — or keep it only in your head and your counsellor\'s notes.'
            ] },
          { heading: 'Section 1 — During an incident',
            bullets: [
              'Safest rooms in my home (exits, no weapons): ____________',
              'Rooms to avoid (kitchen, bathroom, rooms with weapons or no exits): ____________',
              'If I need to leave immediately, my nearest safe exit is: ____________',
              'Neighbour or nearby person I can run to: ____________'
            ] },
          { heading: 'Section 2 — Code word and trusted contacts',
            bullets: [
              'My code word meaning "call for help now": ____________',
              'Person who knows the code word: ____________',
              'Trusted contact 1 (name, number): ____________',
              'Trusted contact 2 (name, number): ____________',
              'Emergency lines: Police 999 / 112 · GBV Helpline 1195 · Childline 116'
            ] },
          { heading: 'Section 3 — Emergency bag',
            bullets: [
              'Location of my packed bag or 5-minute packing list: ____________',
              'Contents: ID and documents (or photos of them), medication, cash, charger, spare keys, children\'s essentials.',
              'Documents I still need to copy or photograph: ____________'
            ] },
          { heading: 'Section 4 — Children\'s plan',
            bullets: [
              'Where the children go in the house when things become frightening: ____________',
              'Which neighbour or relative they run to: ____________',
              'Who collects them from school if I cannot: ____________',
              'The one sentence they know: "Go to ____________, stay there, an adult will come."'
            ] },
          { heading: 'Section 5 — Work, movement, and after leaving',
            bullets: [
              'Safest routes and times for my regular journeys: ____________',
              'Person at work who knows the situation (if any): ____________',
              'If I have a protection order: copies kept at ____________ and with ____________',
              'After leaving: vary routines, change locks where possible, and review this plan with my counsellor within one week.'
            ] }
        ]
      },
      {
        title: 'Digital Safety and Privacy Guide',
        category: 'safety_planning',
        desc: 'Securing your phone and accounts when someone may be monitoring you: settings, tracking, evidence, and safe browsing.',
        subtitle: 'Your phone should serve your safety — not report on it.',
        sections: [
          { heading: 'First, assess quietly',
            paragraphs: [
              'If someone has had access to your phone, assume they may see what you do on it — and change things gradually rather than all at once. A sudden total lock-out can escalate risk; your counsellor can help you sequence these steps safely.'
            ] },
          { heading: 'Phone basics',
            bullets: [
              'Set a screen lock (PIN over pattern; patterns can be watched). Change it if it may be known.',
              'Turn off message previews on the lock screen.',
              'Review installed apps for anything you do not recognise — family-tracker or "parental control" apps are commonly misused as stalkerware.',
              'Check Settings → Location: turn off location sharing with any person, and review which apps can access location "all the time".'
            ] },
          { heading: 'Accounts',
            bullets: [
              'Change passwords for email, M-Pesa, social media, and iCloud/Google — from a safe device if possible.',
              'Turn on two-factor authentication, and make sure recovery numbers and emails are yours alone.',
              'Check "logged-in devices" in each account and sign out sessions you do not recognise.',
              'WhatsApp: Settings → Linked Devices — remove anything unfamiliar.'
            ] },
          { heading: 'Browsing this platform safely',
            bullets: [
              'Use the Quick Exit button — it leaves the site immediately and opens a neutral page.',
              'Use private/incognito browsing, or clear history after each visit.',
              'Sessions here end when the tab closes; nothing stays signed in on a shared device.',
              'The USSD channel works with no internet and leaves no browser trace at all.'
            ] },
          { heading: 'Preserving digital evidence',
            bullets: [
              'Do not delete threatening messages, even when they are painful — screenshot AND keep the originals.',
              'Back screenshots up to an account only you control (e.g. email them to a private address).',
              'Record dates and times of harassing calls; your call log is evidence too.',
              'Do not reply to provocations — preserve, don\'t participate. Your legal counsel can advise on each item.'
            ] },
          { heading: 'If you find tracking software',
            paragraphs: [
              'Do not remove it immediately — removal can alert the person monitoring you. Note what you found, talk to your counsellor or legal counsel about safe timing, and factor it into your safety plan. Removal is best timed with other safety steps, such as moving or a protection order.'
            ] }
        ]
      },
      {
        title: 'County GBV Support Services Directory',
        category: 'service_directory',
        desc: 'County-by-county directory of gender desks, hospital recovery centres, and support services in the platform\'s five service counties.',
        subtitle: 'Nairobi · Mombasa · Kisumu · Nakuru · Uasin Gishu',
        sections: [
          { heading: 'How to use this directory',
            paragraphs: [
              'Every police station in Kenya is required to receive GBV reports; the stations below have dedicated gender desks with trained officers. Hospital-based recovery centres provide free medical care and evidence documentation. For a warm handover to any listed service, ask your assigned counsellor — a phone introduction beats arriving cold.'
            ] },
          { heading: 'Nairobi County',
            contacts: [
              { name: 'GVRC — Nairobi Women\'s Hospital', detail: '+254 719 638 006. Free 24/7 medical and psychosocial care.' },
              { name: 'Kenyatta National Hospital GBVRC', detail: 'Via +254 20 2726300. Public referral centre.' },
              { name: 'POLICARE One-Stop Centre', detail: 'Integrated police, medical, legal and counselling services under one roof.' },
              { name: 'Police gender desks', detail: 'Kilimani, Kayole, Kasarani and Central stations among others; ask for the gender desk officer.' }
            ] },
          { heading: 'Mombasa County',
            contacts: [
              { name: 'Coast General Teaching & Referral Hospital GBVRC', detail: '24/7 via the casualty department.' },
              { name: 'County Gender Department', detail: 'Referrals for shelter and psychosocial support on weekdays.' },
              { name: 'Police gender desks', detail: 'Central, Nyali, Likoni and Changamwe stations.' }
            ] },
          { heading: 'Kisumu County',
            contacts: [
              { name: 'Jaramogi Oginga Odinga Teaching & Referral Hospital', detail: 'GBV clinic and PRC/P3 documentation.' },
              { name: 'Kisumu County gender office', detail: 'Prosperity House; shelter referrals processed weekdays.' },
              { name: 'Police gender desks', detail: 'Kisumu Central and Kondele stations.' }
            ] },
          { heading: 'Nakuru County',
            contacts: [
              { name: 'Nakuru Level 5 (PGH) GBV clinic', detail: 'Medical care, PRC and P3 completion.' },
              { name: 'County Department of Gender', detail: 'Shelter referrals and community support groups.' },
              { name: 'Police gender desks', detail: 'Nakuru Central and Bondeni stations.' }
            ] },
          { heading: 'Uasin Gishu County (Eldoret)',
            contacts: [
              { name: 'Moi Teaching & Referral Hospital (MTRH)', detail: 'GBV recovery services via the Riley Mother & Baby / casualty wings.' },
              { name: 'County gender office', detail: 'Referral coordination for shelter and legal aid.' },
              { name: 'Police gender desks', detail: 'Eldoret Central station and Langas post.' }
            ] },
          { heading: 'Countrywide, any hour',
            contacts: [
              { name: '1195', detail: 'National GBV Helpline — free, 24/7, connects to services in every county.' },
              { name: '116', detail: 'Childline Kenya — anything involving a child.' },
              { name: '999 / 112', detail: 'Police emergency.' }
            ] }
        ]
      },
      {
        title: 'Getting Support Through This Platform',
        category: 'service_directory',
        desc: 'A guide to every support channel on this platform: your care team, direct chats, community rooms, reporting, and USSD.',
        subtitle: 'One account, one assigned team, several safe ways to reach them.',
        sections: [
          { heading: 'Your assigned care team',
            paragraphs: [
              'When you register, the platform automatically assigns you a professional counsellor and a legal counsel — chosen from the least-loaded available staff so you are never in a queue. They appear in your Direct Chat, and everything you tell them is confidential.'
            ],
            bullets: [
              'Counsellor — emotional support, coping strategies, safety planning, shelter referral.',
              'Legal counsel — your rights, documentation (OB, P3, PRC), protection orders, court processes. Free of charge.'
            ] },
          { heading: 'Direct Chat',
            bullets: [
              'Private, end-to-end encrypted messaging with your assigned team.',
              'Presence dots show when your counsellor is online; ticks show sent, delivered, and seen.',
              'You can archive a conversation (it keeps history) or delete it to Trash — and restore it later if you change your mind.'
            ] },
          { heading: 'Community rooms',
            bullets: [
              'Peer support spaces where you appear by your chosen nickname only — never your name or number.',
              'The General Support Circle is for shared experience and encouragement; Legal Rights Awareness hosts Q&A answered by legal counsel.',
              'Moderators keep rooms safe. Use the flag button on any message that feels wrong — reports are anonymous.'
            ] },
          { heading: 'Reporting an incident',
            bullets: [
              'The Report section walks you through describing an incident at your own pace; you control every detail shared.',
              'Evidence (photos, documents) uploads to private storage visible only to your assigned team.',
              'You can track your report\'s status, and withdraw it at any time — reporting never locks you into a process.'
            ] },
          { heading: 'No smartphone? The USSD channel',
            bullets: [
              'The USSD menu works on any phone, with no internet and no app trace.',
              'You can request a callback: a counsellor phones you at the time you choose.',
              'SMS one-time codes secure your account sign-in — no password can be quietly guessed.'
            ] },
          { heading: 'Safety features to know',
            bullets: [
              'Quick Exit button — instantly leaves the platform and opens a neutral website.',
              'Sessions end when the browser tab closes; nothing stays signed in.',
              'Notifications are deliberately discreet — they never mention the platform\'s purpose.',
              'In immediate danger, always use the phone first: 999 / 112, then 1195.'
            ] }
        ]
      }
    ];

    for (const r of resources) {
      const resourceId = id();
      const slug = r.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
      const originalFileName = `${slug}.pdf`;

      // Real multi-page PDF uploaded to Cloudinary — makes
      // GET /api/resources/:id/file stream a genuinely useful document.
      const resourcePdfBuffer = await buildResourcePdfBuffer({
        title:    r.title,
        subtitle: r.subtitle,
        sections: r.sections
      });
      const uploaded = await uploadSupportResourceBuffer({
        buffer: resourcePdfBuffer,
        resourceId,
        category: r.category,
        originalFileName,
        mimeType: 'application/pdf'
      });

      await SupportResource.create({
        resourceId,
        resourceTitle:          r.title,
        resourceDescription:    r.desc,
        resourceCategory:       r.category,
        resourceFileUrl:        uploaded.secure_url,
        cloudinaryPublicId:     uploaded.public_id,
        cloudinaryResourceType: uploaded.resource_type,
        originalFileName,
        mimeType:               'application/pdf',
        fileSizeBytes:          resourcePdfBuffer.length,
        uploadedByStaffId:      ngoAdminUserId1
      });
    }


    // ── 12. OTP REQUESTS ─────────────────────────────────────────────────

    console.log('🌱 Seeding OTP verification requests...');

    await OtpVerificationRequest.create({
      otpRequestId:           id(),
      targetPhoneNumber:      '+254711000099',
      hashedOtpCode:          await hash('482910'),
      otpExpirationTimestamp: new Date(Date.now() + 10 * 60 * 1000), // 10 min from now
      otpVerificationStatus:  'PENDING'
    });
    await OtpVerificationRequest.create({
      otpRequestId:           id(),
      targetPhoneNumber:      '+254711000001',
      hashedOtpCode:          await hash('193847'),
      otpExpirationTimestamp: new Date(Date.now() - 60000), // already expired
      otpVerificationStatus:  'VERIFIED'
    });


    // ── 13. USSD CALLBACK REQUESTS ───────────────────────────────────────

    console.log('🌱 Seeding USSD callback requests...');

    await UssdCallbackRequest.create({ callbackRequestId: id(), requesterPhoneNumber: '+254722000001', callbackFulfillmentStatus: 'PENDING'   });
    await UssdCallbackRequest.create({ callbackRequestId: id(), requesterPhoneNumber: '+254722000002', callbackFulfillmentStatus: 'COMPLETED' });
    await UssdCallbackRequest.create({ callbackRequestId: id(), requesterPhoneNumber: '+254722000003', callbackFulfillmentStatus: 'PENDING'   });


    // ── 14. AUDIT LOG ENTRIES ────────────────────────────────────────────

    console.log('🌱 Seeding audit log entries...');

    await AuditLog.create({ auditId: id(), actorUserId: survivorUserIds[0], actionType: 'LOGIN',               targetEntity: null             });
    await AuditLog.create({ auditId: id(), actorUserId: survivorUserIds[0], actionType: 'REPORT_SUBMITTED',    targetEntity: 'incidentReport' });
    await AuditLog.create({ auditId: id(), actorUserId: ngoAdminUserId1,    actionType: 'COMMUNITY_ROOM_CREATED', targetEntity: 'communityRoom' });
    await AuditLog.create({ auditId: id(), actorUserId: ngoAdminUserId1,    actionType: 'STAFF_ACCOUNT_CREATED', targetEntity: 'userAccount'   });


    console.log('\n✅ Database seeded successfully.');
    console.log('─────────────────────────────────────────');
    console.log('  Moderators:            1');
    console.log('  NGO Admins:            2');
    console.log(`  Counsellors:           ${counsellorData.length}`);
    console.log(`  Legal Counsel:         ${legalData.length}`);
    console.log(`  Survivors:             ${survivorData.length}`);
    console.log('  Reports:               24 (1 escalated to legal case)');
    console.log(`  Community Rooms:       2 (all ${allUserIds.length} users enrolled in both)`);
    console.log(`  Community Messages:    ${communityMessageCount + 2} (incl. 2 flagged for moderation)`);
    console.log(`  Direct Chat Channels:  ${seededChannels.length} (2 per survivor: 1 counsellor + 1 legal)`);
    console.log('    ↳ 1 archived  (Survivor[2] ↔ counsellor)  — Archive/Restore test');
    console.log('    ↳ 1 deleted   (Survivor[3] ↔ legal)       — Trash/Restore test');
    console.log(`  Direct Chat Messages:  ${directMessageCount} (plaintext demo transcripts)`);
    console.log(`  Resources:             ${resources.length} (multi-page PDFs on Cloudinary)`);
    console.log('─────────────────────────────────────────');
    console.log('  Demo credentials (unchanged):');
    console.log('    Survivor:       +254711000001 / Survivor@2026!');
    console.log('    Counsellor:     +254700000020 / Counsellor@2026!');
    console.log('    Legal Counsel:  +254700000030 / LegalCounsel@2026!');
    console.log('    NGO Admin:      +254700000010 / NgoAdmin@2026!');
    console.log('    Moderator:      +254700000001 / Moderator@2026!');
    console.log('─────────────────────────────────────────\n');

  } catch (error) {
    console.error('❌ Seeding failed:', error);
    process.exit(1);

  } finally {
    await sequelize.close();
    console.log('🔒 Database connection closed.');
  }
}

seed();
