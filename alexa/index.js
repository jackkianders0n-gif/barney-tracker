/* Barney's Tracker — Alexa skill (Alexa-hosted, Node.js)
 *
 * Paste this over lambda/index.js in the Alexa Developer Console (Code tab).
 * Everything Alexa says is worked out by the bt-alexa Supabase function, so
 * this file never needs changing.
 *
 * Put the Alexa link from the app (Barney → Settings → Alexa link) between the
 * quotes below. Keep it private: it lets anyone read Barney's summary.
 */
const ALEXA_LINK = "PASTE THE ALEXA LINK FROM THE APP HERE";

const Alexa = require("ask-sdk-core");
const https = require("https");

function getSummary() {
  return new Promise((resolve, reject) => {
    const req = https.get(ALEXA_LINK, { timeout: 7000 }, (res) => {
      let body = "";
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => {
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
  });
}

const SORRY = "Sorry, I couldn't reach Barney's Tracker just now. Try again in a minute.";
const MORE = " You can also ask where to walk him, or what's due.";

// Say one part of the summary: "summary", "walk" or "care"
async function say(handlerInput, part, extra = "") {
  let text;
  try {
    const data = await getSummary();
    text = (data && data.speech && data.speech[part]) || SORRY;
  } catch (e) {
    console.log(e);
    text = SORRY;
  }
  return handlerInput.responseBuilder.speak(text + extra).getResponse();
}

const LaunchHandler = {
  canHandle: (h) => Alexa.getRequestType(h.requestEnvelope) === "LaunchRequest",
  handle: (h) => say(h, "summary", MORE),
};
const SummaryHandler = {
  canHandle: (h) => Alexa.getRequestType(h.requestEnvelope) === "IntentRequest" && Alexa.getIntentName(h.requestEnvelope) === "SummaryIntent",
  handle: (h) => say(h, "summary"),
};
const WalkHandler = {
  canHandle: (h) => Alexa.getRequestType(h.requestEnvelope) === "IntentRequest" && Alexa.getIntentName(h.requestEnvelope) === "WalkIntent",
  handle: (h) => say(h, "walk"),
};
const CareHandler = {
  canHandle: (h) => Alexa.getRequestType(h.requestEnvelope) === "IntentRequest" && Alexa.getIntentName(h.requestEnvelope) === "CareIntent",
  handle: (h) => say(h, "care"),
};
const HelpHandler = {
  canHandle: (h) => Alexa.getRequestType(h.requestEnvelope) === "IntentRequest"
    && ["AMAZON.HelpIntent", "AMAZON.FallbackIntent", "AMAZON.NavigateHomeIntent"].includes(Alexa.getIntentName(h.requestEnvelope)),
  handle: (h) => h.responseBuilder
    .speak("You can ask how Barney is, where to walk him, or what's due, like his flea treatment or the vet. What would you like?")
    .reprompt("Ask how Barney is, where to walk him, or what's due.")
    .getResponse(),
};
const StopHandler = {
  canHandle: (h) => Alexa.getRequestType(h.requestEnvelope) === "IntentRequest"
    && ["AMAZON.CancelIntent", "AMAZON.StopIntent"].includes(Alexa.getIntentName(h.requestEnvelope)),
  handle: (h) => h.responseBuilder.speak("Bye from Barney.").getResponse(),
};
const SessionEndedHandler = {
  canHandle: (h) => Alexa.getRequestType(h.requestEnvelope) === "SessionEndedRequest",
  handle: (h) => h.responseBuilder.getResponse(),
};
const ErrorHandler = {
  canHandle: () => true,
  handle: (h, error) => { console.log(error); return h.responseBuilder.speak(SORRY).getResponse(); },
};

exports.handler = Alexa.SkillBuilders.custom()
  .addRequestHandlers(LaunchHandler, SummaryHandler, WalkHandler, CareHandler, HelpHandler, StopHandler, SessionEndedHandler)
  .addErrorHandlers(ErrorHandler)
  .lambda();
