// Customer-page strings. Keys are added by the slices that use them.
export const en = {
  langToggleLabel: "Language",
  shopUnavailable: "This shop isn't accepting customers right now",

  // Join form
  waitingNow: "{count} waiting now",
  waitingNowOne: "1 person waiting now",
  waitingNowNone: "Nobody is waiting",
  nameLabel: "Your name",
  namePlaceholder: "e.g. Ali",
  nameRequired: "Please enter your name",
  nameTooLong: "Please use 30 characters or fewer",
  privacyNotice:
    "Only the shop sees your name, and we delete it 30 days after your visit.",
  joinButton: "Join queue",

  // Joining
  checkingLocation: "Checking you're at the shop…",
  joining: "Joining the queue…",
  leaving: "Leaving the queue…",
  tryAgain: "Try again",

  // Why a join did not work
  locationDeniedTitle: "We need your location to let you join",
  locationDeniedHelp:
    "Allow location for this site in your browser settings, then try again.",
  locationUnavailableTitle: "We couldn't find your location",
  locationUnavailableHelp:
    "Move somewhere with a clearer signal, then try again.",
  tooFar: "You need to be at the shop to join",
  queueFull: "Queue full, please check back soon",
  lastCallClosed: "Shop is closing soon, not taking new customers",
  alreadyInQueue: "You're already in this queue on this phone",
  joinFailed: "Something went wrong. Please try again.",

  // Waiting
  yourNumber: "Your number",
  youAreNext: "You're next",
  aheadOfYouOne: "1 person ahead of you",
  aheadOfYou: "{count} people ahead of you",
  estimatedWait: "Estimated wait: {min}–{max} min",
  estimatedWaitAbout: "Estimated wait: about {minutes} min",
  inPersonNote: "Customers waiting in person may be served in between",
  headBackNow: "Head back to the shop now",
  headsUpTitle: "⏰ Almost your turn",

  // Called, and done
  yourTurn: "It's your turn",
  goToCounter: "Go to the counter",
  imComing: "I'm coming",
  calledTitle: "🔔 Your turn!",
  servedThanks: "Thanks! See you next time",

  // Leaving
  leaveQueue: "Leave queue",
  leaveConfirmTitle: "Leave the queue?",
  leaveConfirmBody:
    "You'll lose your place. To join again you'll need to scan the QR code at the shop.",
  leaveConfirmStay: "Stay in the queue",
  leaveConfirmLeave: "Leave",

  // Push alerts
  inAppBrowserWarning: "Open in Chrome/Safari to get alerts",
  pushExplainTitle: "Get an alert when it's your turn",
  pushExplainBody:
    "Allow notifications and we'll alert you when it's almost your turn — even if your screen is locked or this page is closed.",
  pushExplainAllow: "Turn on alerts",
  pushExplainNotNow: "Not now",
  pushOn: "Alerts are on — we'll notify you",
  keepPageOpen: "Keep this page open, we'll alert you with sound",

  // Last Call and Close Shop
  lastCallChoiceTitle: "Shop is closing soon",
  lastCallChoiceBody:
    "Move to the next day's queue, or stay today? If you stay, you may not be served.",
  choiceCarry: "Move to next day",
  choiceStay: "Stay today",
  choiceChangeNote: "You can change this until the shop closes.",
  savingChoice: "Saving your choice…",
  choiceUnavailable: "That choice isn't available any more",
  carriedOverBadge: "Moved from previous day",
  shopClosedTitle: "Shop closed, sorry, come back tomorrow",

  // How else a Ticket can end
  noShowTitle: "You missed your turn",
  joinAgain: "Join again",
  scanToJoinAgain: "Scan the QR code at the shop to join again",
  cannotRejoin: "You can't join again from this ticket. Scan the QR code at the shop.",
  leftTitle: "You left the queue",
  removedTitle: "Your ticket was removed",
  ticketGone: "That ticket has already ended",
};

export type Dictionary = Record<keyof typeof en, string>;
