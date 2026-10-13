// ============================================================================
// ONBOARDING CONFIG: single source for the Slack form, the DM copy and the
// celebration messages.
//
// Welcome DM, birthday and anniversary copy: taken from the live Zapier workflow.
// Approval and confirmation messages below are KSC App Hub's own wording.
// Field `id`s map directly to database columns, so keep those unchanged.
// ============================================================================

export const EMPLOYEE_TYPES = ['Disney', 'Jellyland', 'Kawaii Slime In-house', 'None of these']

export const EMPLOYEE_STATUSES = ['active', 'offboarded', 'disabled', 'revoked']

export const ANNOUNCEMENT_OPTIONS = [
  { value: 'public', label: 'Public: celebrate in team channels' },
  { value: 'private_dm', label: 'Private: only send me a DM' },
]

export const ONBOARDING_COPY = {
  // Welcome DM, copied from the live Zapier "Send Direct Message" step.
  // The Zapier form link is replaced by the "Fill Form Here" button (opens the Slack form).
  dmIntro: (slackUserId) =>
    `:tada: *Welcome to the Team! We’re so happy you’re here* :yellow_heart:

Hi <@${slackUserId}>! We’re excited to have you join us :sparkles:

To help us celebrate you (in a way that you actually enjoy), please take a quick moment to fill out the form below:

:birthday: *Share Your Birthday & Work Anniversary Preferences Here:*

*Inside, you’ll be able to let us know:*

• If you’d like your birthday celebrated :balloon:

• If you prefer celebrations to be public or private

• If you’d like your work anniversaries recognized :tada:

• Any preferences around how we celebrate you (or if you’d rather keep things low-key)

:sparkles: *Optional (but fun!):*

• Favorite snacks or treats

• Favorite colors or themes

• Anything else that makes you feel appreciated

We want to celebrate our team in a way that feels thoughtful, respectful, and personal to you :dizzy:`,
  dmClosing: 'Welcome again — we’re really glad you’re here!',
  dmFallbackText: 'Welcome to KSC! Please fill in your onboarding form.',
  buttonLabel: 'Fill Form Here',
  modalTitle: 'KSC Onboarding',
  submitLabel: 'Submit',
  modalIntro: 'Your birthday and work anniversary can only be submitted once. Contact HR to change them later.',
  submittedDm: '✅ Thanks! Your onboarding details are saved.',
  lockedNote: (label, value) => `🔒 ${label}: *${value}* (locked, contact HR to change)`,
  joiningDateHint: 'Set by HR. If you change it, HR will be asked to approve.',
  joiningDatePending: (suggested) => `⏳ A change to *${suggested}* is waiting for HR approval.`,
  approverDmTitle: '📝 *Joining date change requested*',
  approvedDm: '✅ HR approved your joining date update.',
  rejectedDm: 'HR reviewed your joining date update and kept the original date. Contact HR if you have questions.',
}

// Celebration shoutouts (posted to #ksc-chat-room, or sent as DMs for private employees).
export const CELEBRATION_COPY = {
  // Chat-room birthday post, copied from the Zapier "Send Private Channel Message" step.
  birthday: (firstName) =>
    `:tada::birthday: Happy Birthday, ${firstName}! :birthday::tada:

Today we’re celebrating one of our amazing teammates at Kawaii Slime Company :sparkling_heart::rainbow:

${firstName}, thank you for all the hard work, positivity, and great energy you bring to the team every day :sparkles::heart_hands:

Wishing you a day full of happiness, laughter, and lots of cake :cake::gift::partying_face:

We’re so lucky to have you with us, and we hope this year brings you even more success and joy :rocket::purple_heart:

:balloon: <!channel>, let’s all wish ${firstName} a very Happy Birthday in the channel! :tada::confetti_ball:`,
  // Birthday DM for private_dm employees (Zapier DM copy).
  privateDmBirthday: (firstName) =>
    `🎉 Hey ${firstName}! 🥳

Wishing you the happiest birthday ever! 🎂🎈🎁

Hope your day is filled with lots of joy, laughter, cake, and amazing moments ✨🍰🎊

Thank you for being such a wonderful part of the team — we’re lucky to have you! 🌟💼

Here’s to an awesome year ahead filled with success, happiness, and everything you wish for 🚀🎉

Enjoy your special day! 🎂🎉🎈`,
  // Chat-room work anniversary post, copied from the Zapier "Send Private Channel Message" step.
  anniversary: (firstName, years) =>
    `:tada::trophy: Happy Work Anniversary, ${firstName}! :trophy::tada:

Today we’re celebrating an important milestone for one of our wonderful teammates at Kawaii Slime Company :sparkling_heart::sparkles:

${firstName}, thank you for your dedication, hard work, and all the positive impact you’ve made on our team :rainbow::rocket:

We truly appreciate everything you do and are so grateful to have you as part of this journey :heart_hands::purple_heart:

Here’s to this amazing milestone and many more successful years ahead :gift::partying_face::sparkles:

:balloon: <!channel>, let’s all congratulate ${firstName} on their ${years} successful years at KSC and drop your wishes in the channel! :tada::confetti_ball:`,
  // Anniversary DM for private_dm employees, copied from the Zapier DM step.
  privateDmAnniversary: (firstName, years) =>
    `Hi ${firstName} 😊💖

🎉 Happy ${years} year work anniversary!! 🎉

It’s been so wonderful having you as part of our kawaii family 🧸✨

Your efforts, creativity, and positive vibes truly make a difference every day 🌈

We really appreciate everything you do — you help make this place more fun, colorful, and full of life 🎀

Here’s to celebrating you today and many more amazing years ahead 💫

Have a super cute and happy day!! 🥳💕`,
}

// Fields shown in the Slack modal, in order. `lockAfterSubmit` means the
// employee can submit it once; later changes need HR (see employees.js).
export const FORM_FIELDS = [
  { id: 'full_name', type: 'text', label: 'Full name', required: true },
  { id: 'email', type: 'text', label: 'Work email', required: false },
  { id: 'employee_type', type: 'select', label: 'Employee type', required: true },
  { id: 'joining_date', type: 'date', label: 'Joining date', hrManaged: true },
  { id: 'birthday', type: 'date', label: 'Birthday', lockAfterSubmit: true },
  { id: 'anniversary', type: 'date', label: 'Work anniversary', lockAfterSubmit: true },
  { id: 'favorite_slime', type: 'text', label: 'Favorite slime', required: false },
  { id: 'favorite_color', type: 'text', label: 'Favorite color', required: false },
  { id: 'favorite_snack', type: 'text', label: 'Favorite snack', required: false },
  { id: 'celebration_notes', type: 'textarea', label: 'Any preferences around how we celebrate you?', required: false },
  { id: 'announcement_preference', type: 'radio', label: 'How should we celebrate you?', required: true },
]
