/* Barney's Tracker — Alexa skill (Alexa-hosted, Node.js)
 *
 * Paste this over lambda/index.js in the Alexa Developer Console (Code tab).
 * Everything Alexa says is worked out by the bt-alexa Supabase function.
 *
 * On an Echo Show, opening the skill shows the Barney card: Fed, Water, Wee and
 * Poo buttons like the app's Today screen. Taps are sent to bt-alexa, which logs
 * them as "Echo Show". The skill needs the Alexa Presentation Language interface
 * turned on (Build → Interfaces) for the card to show. Devices without a screen
 * hear the summary as before.
 *
 * Put the Alexa link from the app (Barney → Settings → Alexa link) between the
 * quotes below. Keep it private: it lets anyone read Barney's summary and log
 * meals, water, wees and poos.
 */
const ALEXA_LINK = "PASTE THE ALEXA LINK FROM THE APP HERE";
const PHOTO = "https://jackkianders0n-gif.github.io/barney-tracker/barney.jpg";

const Alexa = require("ask-sdk-core");
const https = require("https");

// GET the summary, or POST an action from the card, to bt-alexa
function call(method, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = https.request(ALEXA_LINK, {
      method, timeout: 7000,
      headers: data ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } : {},
    }, (res) => {
      let text = "";
      res.on("data", (chunk) => { text += chunk; });
      res.on("end", () => {
        let json = null;
        try { json = JSON.parse(text); } catch (e) { /* not JSON */ }
        if (res.statusCode >= 200 && res.statusCode < 300 && json) resolve(json);
        else reject(new Error((json && json.error) || `bt-alexa ${res.statusCode}`));
      });
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}
const getSummary = () => call("GET");

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

// ---------------------------------------------------------------------------
// The Barney card (Alexa Presentation Language)

const TOKEN = "barney-card";
const hasScreen = (h) => !!Alexa.getSupportedInterfaces(h.requestEnvelope)["Alexa.Presentation.APL"];

const LOGGED = { fed: "Food's down", water: "Water topped up", wee: "Wee logged", poo: "Poo logged" };
const EATEN = [
  { key: 100, label: "All of it", note: "Ate it all" },
  { key: 75, label: "Most", note: "Ate most of it" },
  { key: 50, label: "Half", note: "Ate half" },
  { key: 25, label: "A little", note: "Ate a little" },
  { key: 0, label: "None", note: "Didn't eat it" },
];

// The app's icons (ICONS in app.jsx), drawn on a 24 by 24 grid
const icon = (paths) => ({
  type: "AVG", version: "1.2", width: 24, height: 24,
  parameters: [{ name: "color", default: "#C98A4B" }],
  items: paths.map((d) => ({ type: "path", pathData: d, stroke: "${color}", strokeWidth: 1.9, fill: "transparent", strokeLineCap: "round", strokeLineJoin: "round" })),
});
const circle = (cx, cy, r) => `M${cx - r},${cy} a${r},${r} 0 1,0 ${2 * r},0 a${r},${r} 0 1,0 ${-2 * r},0`;
const pill = (x, y, w, h) => { const r = h / 2; return `M${x + r},${y} h${w - h} a${r},${r} 0 0 1 0,${h} h${-(w - h)} a${r},${r} 0 0 1 0,${-h} z`; };
const GRAPHICS = {
  bowl: icon(["M3.5 12.5h17l-1.6 5.6a2 2 0 0 1-1.9 1.4H7a2 2 0 0 1-1.9-1.4z", circle(8.5, 9.3, 1.4), circle(12, 7.6, 1.4), circle(15.5, 9.3, 1.4)]),
  water: icon(["M3.5 14h17l-1.3 4.6a2 2 0 0 1-1.9 1.4H6.7a2 2 0 0 1-1.9-1.4z", "M12 3.5c-1.9 2.4-2.9 4-2.9 5.3a2.9 2.9 0 0 0 5.8 0c0-1.3-1-2.9-2.9-5.3z"]),
  hydrant: icon(["M8.5 9.5a3.5 3.5 0 0 1 7 0", "M12 6V4.5", "M7 9.5h10", "M8.5 9.5V20M15.5 9.5V20", "M6.5 20h11", "M8.5 12.5h-2v3h2M15.5 12.5h2v3h-2", circle(12, 14, 1.3)]),
  poo: icon([pill(4, 15, 16, 5), pill(6.5, 10.5, 11, 4.5), "M9 10.5a2 2 0 0 1 0-4h3.5c1 0 1.7-.6 1.9-1.6 1.1.6 1.6 1.6 1.6 2.9a2.7 2.7 0 0 1-2.7 2.7"]),
  check: icon(["M5 12.5l4.5 4.5L19 7.5"]),
};

const COLORS = { cream: "#FBF4EA", paper: "#FFFDF9", navy: "#1B2340", apricot: "#E9B97F", apricotSoft: "#F6E2C6", tan: "#C98A4B", tanInk: "#8A5523", line: "#E8D9C4", inkSoft: "#5B6178" };

// Sizes in dp, worked out from the screen so nothing depends on percentages (which
// some Echo screens resolve against the whole screen): the collar is 100 high; under
// it the tiles have 24 either side, 20 between, 20 above, 20 between rows, 24 below.
const COLLAR_H = 100;
const TILE_W = "${Math.max(200, (viewport.width - 68) / 2)}";
const TILE_H = "${Math.max(120, (viewport.height - 164) / 2)}";
const TILE_IN_W = "${Math.max(196, (viewport.width - 68) / 2 - 4)}"; // inside the 2dp border
const TILE_IN_H = "${Math.max(116, (viewport.height - 164) / 2 - 4)}";

// One tile. Its bound values change on the device as soon as it's tapped; the skill
// then logs it and shows "Wee logged · Undo" along the top.
const TILE = {
  parameters: ["kind", "label", "icon", "tile", "words"],
  item: {
    type: "TouchWrapper", id: "tile-${kind}", width: TILE_W, height: TILE_H,
    bind: [
      { name: "justLogged", value: false, type: "boolean" },
      { name: "down", value: "${tile.down == true}", type: "boolean" },
      { name: "line", value: "${tile.line}", type: "string" },
      { name: "note", value: "${tile.note || ''}", type: "string" },
    ],
    onPress: [
      // His food's down: ask how much he ate
      { type: "SetValue", componentId: "eatenPanel", property: "display", value: "normal", when: "${kind == 'fed' && down}" },
      {
        type: "Sequential", when: "${kind != 'fed' || !down}",
        commands: [
          { type: "SetValue", property: "justLogged", value: true },
          { type: "SetValue", property: "line", value: "${kind == 'fed' ? words.downNow : 'Just now'}" },
          { type: "SetValue", property: "note", value: "${kind == 'fed' ? words.downNote : note}" },
          { type: "SetValue", property: "down", value: "${kind == 'fed'}" },
          { type: "SendEvent", arguments: ["log", "${kind}"] },
          { type: "SetValue", property: "justLogged", value: false, delay: 2500 },
        ],
      },
    ],
    item: {
      type: "Frame", width: TILE_W, height: TILE_H, borderRadius: 24, borderWidth: 2,
      backgroundColor: "${justLogged ? '#F6E2C6' : '#FFFDF9'}",
      borderColor: "${down ? '#E9B97F' : '#E8D9C4'}",
      item: {
        type: "Container", direction: "row", alignItems: "center", width: TILE_IN_W, height: TILE_IN_H, paddingLeft: 22, paddingRight: 18,
        items: [
          {
            type: "Frame", width: 84, height: 84, borderRadius: 42, backgroundColor: "${justLogged ? '#1B2340' : '#F6E2C6'}",
            item: {
              type: "Container", width: 84, height: 84, justifyContent: "center", alignItems: "center",
              items: [
                { type: "VectorGraphic", source: "${icon}", width: 48, height: 48, scale: "best-fit", color: COLORS.tan, display: "${justLogged ? 'none' : 'normal'}" },
                { type: "VectorGraphic", source: "check", width: 48, height: 48, scale: "best-fit", color: COLORS.apricot, display: "${justLogged ? 'normal' : 'none'}" },
              ],
            },
          },
          {
            type: "Container", direction: "column", paddingLeft: 20, shrink: 1, grow: 1,
            items: [
              { type: "Text", text: "${label}", fontSize: 34, fontWeight: "700", color: COLORS.navy, maxLines: 1 },
              { type: "Text", text: "${line}", fontSize: 22, color: COLORS.inkSoft, maxLines: 1, paddingTop: 2 },
              { type: "Text", text: "${note}", fontSize: 19, fontWeight: "700", color: COLORS.tanInk, maxLines: 1, paddingTop: 2, display: "${note ? 'normal' : 'none'}" },
            ],
          },
        ],
      },
    },
  },
};

const CARD_DOC = {
  type: "APL", version: "1.8", theme: "light",
  settings: { idleTimeout: 60000 }, // back to the home screen a minute after the last tap
  graphics: GRAPHICS,
  layouts: { Tile: TILE },
  mainTemplate: {
    parameters: ["barney"],
    item: {
      type: "Frame", width: "100vw", height: "100vh", backgroundColor: COLORS.cream,
      item: {
        type: "Container", width: "100vw", height: "100vh",
        items: [
          // The navy collar: his photo, his name and today's walking, and what was just logged
          {
            type: "Frame", backgroundColor: COLORS.navy, width: "100vw", height: COLLAR_H,
            item: {
              type: "Container", direction: "row", alignItems: "center", width: "100vw", height: COLLAR_H, paddingLeft: 28, paddingRight: 24,
              items: [
                {
                  type: "Frame", width: 72, height: 72, borderRadius: 36, borderWidth: 3, borderColor: COLORS.apricot,
                  item: { type: "Image", source: "${barney.photo}", width: 66, height: 66, borderRadius: 33, scale: "best-fill" },
                },
                {
                  type: "Container", direction: "column", paddingLeft: 18, grow: 1, shrink: 1,
                  items: [
                    { type: "Text", text: "Barney", fontSize: 36, fontWeight: "700", color: COLORS.cream, maxLines: 1 },
                    { type: "Text", text: "${barney.card.walk}", fontSize: 20, color: COLORS.apricot, maxLines: 1 },
                  ],
                },
                {
                  type: "Container", id: "statusBar", direction: "row", alignItems: "center", display: "none",
                  items: [
                    { type: "Text", id: "statusText", text: "", fontSize: 22, fontWeight: "700", color: COLORS.cream, maxLines: 1 },
                    {
                      type: "TouchWrapper", id: "undoButton", spacing: 16,
                      onPress: [
                        { type: "SetValue", componentId: "statusBar", property: "display", value: "none" },
                        { type: "SendEvent", arguments: ["undo"] },
                      ],
                      item: {
                        type: "Frame", backgroundColor: COLORS.apricot, borderRadius: 24,
                        item: { type: "Text", text: "Undo", fontSize: 22, fontWeight: "700", color: COLORS.navy, paddingLeft: 22, paddingRight: 22, paddingTop: 8, paddingBottom: 8 },
                      },
                    },
                  ],
                },
              ],
            },
          },
          // The four tiles
          {
            type: "Container", direction: "column", paddingLeft: 24, paddingRight: 24, paddingTop: 20, paddingBottom: 24,
            items: [
              {
                type: "Container", direction: "row", height: TILE_H,
                items: [
                  { type: "Tile", kind: "fed", label: "Fed", icon: "bowl", tile: "${barney.card.fed}", words: "${barney.words}" },
                  { type: "Tile", kind: "water", label: "Water", icon: "water", tile: "${barney.card.water}", words: "${barney.words}", spacing: 20 },
                ],
              },
              {
                type: "Container", direction: "row", height: TILE_H, spacing: 20,
                items: [
                  { type: "Tile", kind: "wee", label: "Wee", icon: "hydrant", tile: "${barney.card.wee}", words: "${barney.words}" },
                  { type: "Tile", kind: "poo", label: "Poo", icon: "poo", tile: "${barney.card.poo}", words: "${barney.words}", spacing: 20 },
                ],
              },
            ],
          },
          // How much did he eat? Shown when Fed is tapped while his food's down
          {
            type: "Frame", id: "eatenPanel", position: "absolute", top: 0, left: 0, width: "100vw", height: "100vh",
            backgroundColor: "rgba(27, 35, 64, 0.7)", display: "none",
            item: {
              type: "Container", width: "100vw", height: "100vh", justifyContent: "center", alignItems: "center",
              items: [{
                type: "Frame", backgroundColor: COLORS.cream, borderRadius: 28, width: "88vw",
                item: {
                  type: "Container", direction: "column", alignItems: "center", paddingLeft: 28, paddingRight: 28, paddingTop: 28, paddingBottom: 20,
                  items: [
                    { type: "Text", text: "How much did he eat?", fontSize: 32, fontWeight: "700", color: COLORS.navy },
                    {
                      type: "Container", direction: "row", paddingTop: 24, data: "${barney.eaten}",
                      items: [{
                        type: "TouchWrapper", spacing: 12,
                        onPress: [
                          { type: "SetValue", componentId: "eatenPanel", property: "display", value: "none" },
                          { type: "SetValue", componentId: "tile-fed", property: "down", value: false },
                          { type: "SetValue", componentId: "tile-fed", property: "line", value: "Just now" },
                          { type: "SetValue", componentId: "tile-fed", property: "note", value: "${data.note}" },
                          { type: "SendEvent", arguments: ["eaten", "${data.key}"] },
                        ],
                        item: {
                          type: "Frame", backgroundColor: COLORS.paper, borderRadius: 24, borderWidth: 2, borderColor: COLORS.apricot,
                          item: { type: "Text", text: "${data.label}", fontSize: 24, fontWeight: "700", color: COLORS.navy, paddingLeft: 20, paddingRight: 20, paddingTop: 12, paddingBottom: 12 },
                        },
                      }],
                    },
                    {
                      type: "TouchWrapper", spacing: 16,
                      onPress: [{ type: "SetValue", componentId: "eatenPanel", property: "display", value: "none" }],
                      item: { type: "Text", text: "Not yet", fontSize: 22, fontWeight: "700", color: COLORS.tanInk, paddingTop: 10, paddingBottom: 10, paddingLeft: 24, paddingRight: 24 },
                    },
                  ],
                },
              }],
            },
          },
        ],
      },
    },
  },
};

const cardDirective = (card) => ({
  type: "Alexa.Presentation.APL.RenderDocument", token: TOKEN, document: CARD_DOC,
  datasources: { barney: { card, photo: PHOTO, eaten: EATEN, words: { downNow: "Down just now", downNote: "Tap when he's eaten" } } },
});
const commands = (list) => ({ type: "Alexa.Presentation.APL.ExecuteCommands", token: TOKEN, commands: list });
// "Wee logged" along the top for 12 seconds, with Undo for logs
const status = (text, undo) => [
  { type: "SetValue", componentId: "statusText", property: "text", value: text },
  { type: "SetValue", componentId: "undoButton", property: "display", value: undo ? "normal" : "none" },
  { type: "SetValue", componentId: "statusBar", property: "display", value: "normal" },
  { type: "SetValue", componentId: "statusBar", property: "display", value: "none", delay: 12000 },
];

// Show the card, and remember which meal is down so "How much did he eat?" can tick it
async function showCard(h) {
  const data = await getSummary();
  if (!data || !data.card) throw new Error("No card in the summary");
  h.attributesManager.setSessionAttributes({ downId: data.card.fed.down ? data.card.fed.id : null, lastId: null });
  return h.responseBuilder.addDirective(cardDirective(data.card)).getResponse();
}

// Something went wrong after a tap: say so, and put the card back as it really is
async function tapFailed(h, e) {
  console.log(e);
  const msg = /already been ticked/i.test(e.message) ? "That meal's already been ticked." : /too late/i.test(e.message) ? "Too late to undo that." : "That didn't save. Try again.";
  try {
    const data = await getSummary();
    const attrs = h.attributesManager.getSessionAttributes();
    attrs.downId = data.card.fed.down ? data.card.fed.id : null;
    attrs.lastId = null;
    h.attributesManager.setSessionAttributes(attrs);
    return h.responseBuilder.speak(msg).addDirective(cardDirective(data.card)).addDirective(commands(status(msg, false))).getResponse();
  } catch (again) {
    console.log(again);
    return h.responseBuilder.speak(SORRY).getResponse();
  }
}

const LaunchHandler = {
  canHandle: (h) => Alexa.getRequestType(h.requestEnvelope) === "LaunchRequest",
  async handle(h) {
    if (!hasScreen(h)) return say(h, "summary", MORE);
    try { return await showCard(h); } catch (e) { console.log(e); return say(h, "summary", MORE); }
  },
};

// Taps on the card: ["log", kind], ["eaten", amount] or ["undo"]
const TapHandler = {
  canHandle: (h) => Alexa.getRequestType(h.requestEnvelope) === "Alexa.Presentation.APL.UserEvent",
  async handle(h) {
    const [what, value] = h.requestEnvelope.request.arguments || [];
    const attrs = h.attributesManager.getSessionAttributes() || {};
    try {
      if (what === "log" && LOGGED[value]) {
        const res = await call("POST", { action: "log", kind: value });
        attrs.lastId = res.id;
        if (value === "fed") attrs.downId = res.id;
        h.attributesManager.setSessionAttributes(attrs);
        return h.responseBuilder.addDirective(commands(status(LOGGED[value], true))).getResponse();
      }
      if (what === "eaten") {
        if (!attrs.downId) throw new Error("That meal's already been ticked");
        const amount = Number(value);
        const res = await call("POST", { action: "eaten", id: attrs.downId, eaten: amount });
        if (attrs.lastId === attrs.downId) attrs.lastId = null;
        attrs.downId = null;
        h.attributesManager.setSessionAttributes(attrs);
        const e = EATEN.find((x) => x.key === amount);
        const meal = res.meal ? res.meal.charAt(0).toUpperCase() + res.meal.slice(1) : "Meal";
        return h.responseBuilder.addDirective(commands(status(`${meal}: ${e ? e.note.toLowerCase() : "ticked"}`, false))).getResponse();
      }
      if (what === "undo") {
        if (!attrs.lastId) return h.responseBuilder.addDirective(commands(status("Nothing to undo", false))).getResponse();
        const res = await call("POST", { action: "undo", id: attrs.lastId });
        attrs.lastId = null;
        attrs.downId = res.card.fed.down ? res.card.fed.id : null;
        h.attributesManager.setSessionAttributes(attrs);
        // Put the tiles back as they were
        return h.responseBuilder.addDirective(cardDirective(res.card)).addDirective(commands(status("Undone", false))).getResponse();
      }
      return h.responseBuilder.getResponse();
    } catch (e) {
      return tapFailed(h, e);
    }
  },
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
  handle: (h) => h.responseBuilder.speak("Bye from Barney.").withShouldEndSession(true).getResponse(),
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
  .addRequestHandlers(LaunchHandler, TapHandler, SummaryHandler, WalkHandler, CareHandler, HelpHandler, StopHandler, SessionEndedHandler)
  .addErrorHandlers(ErrorHandler)
  .lambda();
