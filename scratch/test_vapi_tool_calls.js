const http = require('http');
const fetch = require('node-fetch');

// Import the Express app from the project's api/index.js
const app = require('../api/index');

const TEST_PORT = 5555;

async function runTests() {
  // Start the Express server on the temporary test port
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(TEST_PORT, resolve));
  console.log(`📡 Temporary test server running on port ${TEST_PORT}`);

  const baseUrl = `http://localhost:${TEST_PORT}/api/vapi/webhook`;

  // Define our test cases
  const testCases = [
    {
      name: "Legacy 'function-call' format - Valid booking",
      payload: {
        message: {
          type: "function-call",
          call: {
            id: "call_legacy_123",
            customer: { number: "+971501112222", name: "Ahmed Al-Mansoori" }
          },
          functionCall: {
            id: "fn_call_abc123",
            name: "bookVisit",
            parameters: {
              visit_date: "tomorrow",
              visit_time: "3 PM",
              property_interest: "Marina Heights Villa"
            }
          }
        }
      },
      expectedStatus: 200,
      verify: (resBody) => {
        if (!resBody.results || resBody.results[0].toolCallId !== "fn_call_abc123") {
          throw new Error("Results list is incorrect or missing toolCallId");
        }
        if (resBody.success !== true || !resBody.message.includes("booked successfully")) {
          throw new Error("Missing or incorrect success/message properties");
        }
      }
    },
    {
      name: "New 'tool-calls' format - Valid booking with relative dates and spoken time",
      payload: {
        message: {
          type: "tool-calls",
          call: {
            id: "call_new_456",
            customer: { number: "+971502223333", name: "Sarah Connor" }
          },
          toolCalls: [
            {
              id: "tool_call_new_789",
              type: "function",
              function: {
                name: "bookVisit",
                arguments: {
                  visit_date: "next Friday",
                  visit_time: "11:30 AM",
                  property_interest: "Downtown Penthouse"
                }
              }
            }
          ]
        }
      },
      expectedStatus: 200,
      verify: (resBody) => {
        if (!resBody.results || resBody.results[0].toolCallId !== "tool_call_new_789") {
          throw new Error("Results list is incorrect or missing toolCallId");
        }
        if (resBody.success !== true || !resBody.message.includes("booked successfully")) {
          throw new Error("Missing or incorrect success/message properties");
        }
      }
    },
    {
      name: "New 'tool-calls' format - Invalid date validation failure",
      payload: {
        message: {
          type: "tool-calls",
          call: {
            id: "call_invalid_date",
            customer: { number: "+971503334444", name: "John Doe" }
          },
          toolCalls: [
            {
              id: "tool_call_invalid_date",
              type: "function",
              function: {
                name: "bookVisit",
                arguments: {
                  visit_date: "not a date",
                  visit_time: "2:00 PM"
                }
              }
            }
          ]
        }
      },
      expectedStatus: 200,
      verify: (resBody) => {
        if (resBody.success !== false) {
          throw new Error("Expected success to be false for invalid date");
        }
        if (!resBody.reason || !resBody.reason.includes("is not a valid date format")) {
          throw new Error("Missing or incorrect detailed failure reason");
        }
      }
    },
    {
      name: "New 'tool-calls' format - Invalid time validation failure",
      payload: {
        message: {
          type: "tool-calls",
          call: {
            id: "call_invalid_time",
            customer: { number: "+971504445555", name: "Jane Smith" }
          },
          toolCalls: [
            {
              id: "tool_call_invalid_time",
              type: "function",
              function: {
                name: "bookVisit",
                arguments: {
                  visit_date: "2026-06-15",
                  visit_time: "not a time"
                }
              }
            }
          ]
        }
      },
      expectedStatus: 200,
      verify: (resBody) => {
        if (resBody.success !== false) {
          throw new Error("Expected success to be false for invalid time");
        }
        if (!resBody.reason || !resBody.reason.includes("is not a valid time format")) {
          throw new Error("Missing or incorrect detailed failure reason");
        }
      }
    },
    {
      name: "New 'tool-calls' format - transferCall execution",
      payload: {
        message: {
          type: "tool-calls",
          call: {
            id: "call_transfer_123",
            customer: { number: "+971505556666" }
          },
          toolCalls: [
            {
              id: "tool_call_transfer",
              type: "function",
              function: {
                name: "transferCall",
                arguments: {
                  reason: "user_requested"
                }
              }
            }
          ]
        }
      },
      expectedStatus: 200,
      verify: (resBody) => {
        if (resBody.success !== true || !resBody.message.includes("Transfer initiated successfully")) {
          throw new Error("Transfer call failed or returned incorrect response schema");
        }
      }
    }
  ];

  let passedAll = true;

  for (const tc of testCases) {
    console.log(`\n--------------------------------------------------`);
    console.log(`🏃 Running Test: ${tc.name}`);
    try {
      const response = await fetch(baseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(tc.payload)
      });

      if (response.status !== tc.expectedStatus) {
        throw new Error(`Expected HTTP status ${tc.expectedStatus}, got ${response.status}`);
      }

      const body = await response.json();
      console.log(`📥 Received Response:\n`, JSON.stringify(body, null, 2));

      tc.verify(body);
      console.log(`✅ TEST PASSED: ${tc.name}`);
    } catch (err) {
      console.error(`❌ TEST FAILED: ${tc.name}\n`, err.message);
      passedAll = false;
    }
  }

  // Shut down the temporary test server
  server.close();
  console.log(`\n--------------------------------------------------`);
  console.log(`🛑 Temporary test server stopped.`);
  
  if (passedAll) {
    console.log(`🎉 SUCCESS: All ${testCases.length} test cases passed flawlessly!`);
    process.exit(0);
  } else {
    console.error(`❌ FAILURE: One or more test cases failed.`);
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error("Critical test execution failure:", err);
  process.exit(1);
});
