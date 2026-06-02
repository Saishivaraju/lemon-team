const fetch = require('node-fetch');
async function test() {
  const payload = {
    message: {
      type: "tool-calls",
      toolWithToolCallList: [
        {
          toolCall: {
            id: "call_abc123",
            name: "bookVisit",
            arguments: { visit_date: "2026-06-02", visit_time: "14:00" }
          }
        }
      ],
      toolCalls: [
        {
          id: "call_abc123",
          type: "function",
          function: {
            name: "bookVisit",
            arguments: { visit_date: "2026-06-02", visit_time: "14:00" }
          }
        }
      ]
    }
  };
  
  const res = await fetch('http://localhost:3000/api/vapi/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  console.log(await res.text());
}
test();
