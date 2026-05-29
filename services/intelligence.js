const { GoogleGenerativeAI } = require('@google/generative-ai');

/**
 * Analyzes a raw call transcript using Gemini to extract actionable business intelligence.
 * @param {string} transcript The conversation transcript
 * @returns {Promise<Object>} The extracted intelligence object
 */
async function analyzeTranscript(transcript) {
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_API_KEY || !transcript || transcript.trim().length === 0) {
    return _getFallbackIntelligence();
  }

  try {
    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({
      model: 'gemini-3-flash-preview',
      generationConfig: {
        responseMimeType: "application/json",
      }
    });

    const prompt = `You are an elite Real Estate AI Data Extraction system.
Analyze the following phone call transcript between an AI real estate agent and a lead.
Extract the following information and output it EXACTLY as a JSON object with no markdown formatting.

JSON Schema Required:
{
  "lead_score": "HOT" | "WARM" | "COLD",
  "priority": "CALL IMMEDIATELY" | "FOLLOW UP" | "LONG TERM NURTURE",
  "intent": "Buyer" | "Seller" | "Renter" | "Browser",
  "timeline": "Immediate" | "Within 30 Days" | "Within 90 Days" | "3-6 Months" | "6+ Months" | "Unknown",
  "objections": ["String of objection 1", "String of objection 2"], // Extract specific concerns like "Needs financing", "Wants lower price", etc. Empty array if none.
  "closing_probability": number, // 0 to 100 representing percentage likelihood of closing based on urgency and budget
  "call_summary": "Concise 3-4 sentence summary of the call",
  "ai_notes": "Actionable next steps for the human agent",
  "extracted_budget_numeric": number, // Extract the stated budget as a pure number, e.g. 600000. Use 0 if not mentioned.
  "outcome": "BOOKED" | "FOLLOW UP" | "NOT INTERESTED", // BOOKED if appointment was successfully scheduled, FOLLOW UP if interested but needs another call, NOT INTERESTED if rejects
  "extracted_email": "string" | null, // Normalize and clean any spoken email (e.g. "john at gmail dot com" -> "john@gmail.com"). Use null if not mentioned.
  "extracted_phone": "string" | null // Normalize and clean any spoken phone number to standard digits with plus sign (e.g. "plus one two three..." -> "+1234567890"). Use null if not mentioned.
}

Logic Rules:
- HOT: Interested now, has budget, timeline under 30 days, or wants appointment.
- WARM: Interested, timeline 1-3 months, needs follow up.
- COLD: No urgency, browsing only, 6+ months.
- CALL IMMEDIATELY: Hot leads or ready to buy.
- FOLLOW UP: Warm leads or missed calls that need attention.
- LONG TERM NURTURE: Cold leads.

Transcript:
"""
${transcript}
"""
`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text().replace(/```json/g, '').replace(/```/g, '').trim();
    const data = JSON.parse(text);

    // Calculate commission internally (3% standard agent commission rate)
    data.potential_commission = data.extracted_budget_numeric ? Math.round(data.extracted_budget_numeric * 0.03) : 0;

    return data;
  } catch (err) {
    console.error('Intelligence extraction failed:', err.message);
    return _getFallbackIntelligence();
  }
}

function _getFallbackIntelligence() {
  return {
    lead_score: 'WARM',
    priority: 'FOLLOW UP',
    intent: 'Unknown',
    timeline: 'Unknown',
    objections: [],
    closing_probability: 50,
    call_summary: 'Call completed but AI analysis was unavailable or transcript was empty.',
    ai_notes: 'Review the recording to manually qualify this lead.',
    extracted_budget_numeric: 0,
    potential_commission: 0,
    outcome: 'FOLLOW UP',
    extracted_email: null,
    extracted_phone: null
  };
}

module.exports = {
  analyzeTranscript
};
