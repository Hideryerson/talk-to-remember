import { WebSocket } from 'ws';

const targetUrl = "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=YOUR_API_KEY";

const ws = new WebSocket(targetUrl);

const setupMsg = {
    setup: {
        model: "models/gemini-2.0-flash-exp",
        generationConfig: {
            responseModalities: ["AUDIO"]
        },
        tools: [{ functionDeclarations: [{ name: "edit_photo", description: "edit photo", parameters: { type: "object", properties: { p: { type: "string" } } } }] }]
    }
};

ws.on('open', () => {
    ws.send(JSON.stringify(setupMsg));
    console.log("Connected");
    setTimeout(() => {
        ws.send(JSON.stringify({
            clientContent: { turns: [{ role: "user", parts: [{ text: "Call the edit_photo capability now." }] }], turnComplete: true }
        }));
    }, 1000);
});

ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data.toString()); } catch (e) { return; }

    if (msg.serverContent && msg.serverContent.modelTurn) {
        console.log("AI:", msg.serverContent.modelTurn.parts[0].text);
    }

    if (msg.toolCall) {
        console.log("Got toolCall:", JSON.stringify(msg.toolCall));
        const id = msg.toolCall.functionCalls[0].id;

        // Let's test standard toolResponse
        const respMsg = {
            toolResponse: {
                functionResponses: [{ id: id, name: "edit_photo", response: { result: "ok" } }]
            }
        };
        console.log("Sending toolResponse:", JSON.stringify(respMsg));
        ws.send(JSON.stringify(respMsg));

        setTimeout(() => {
            ws.send(JSON.stringify({
                clientContent: { turns: [{ role: "user", parts: [{ text: "Proceed." }] }], turnComplete: true }
            }));
        }, 1500);
    }
});

ws.on('close', (code, reason) => {
    console.log("WS Closed:", code, reason.toString());
    process.exit(0);
});
ws.on('error', console.error);
