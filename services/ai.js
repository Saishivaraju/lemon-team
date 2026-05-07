const { GoogleGenerativeAI } = require("@google/generative-ai");

// Initialize Gemini API
const apiKey = process.env.GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(apiKey);

/**
 * Generates a persuasive property description using Gemini.
 */
const generateDescription = async (details) => {
  try {
    if (!apiKey) throw new Error("GEMINI_API_KEY is missing in .env");

    // Try flash first, fallback to pro
    let model;
    try {
      model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });
    } catch (e) {
      model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    }

    const prompt = `You are an expert luxury real estate copywriter. 
    Write a persuasive, high-end property description for the following details: ${details}.
    Focus on lifestyle, premium finishes, and investment value. 
    The description should be about 3-4 paragraphs long. 
    Keep it sophisticated and professional.`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();
    
    return { success: true, text };
  } catch (err) {
    console.error('Gemini AI Error (Description):', err.message);
    return {
      success: false,
      error: "Gemini API Error: " + err.message
    };
  }
};

/**
 * Generates a context-aware WhatsApp/SMS follow-up message using Gemini.
 */
const generatePitchScript = async (lead, properties) => {
  try {
    if (!apiKey) throw new Error("GEMINI_API_KEY is missing");

    const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });
    const propDetails = properties.map(p => `${p.name} in ${p.address} ($${p.price})`).join(', ');
    
    const prompt = `You are Sarah Al-Rashid, a top real estate agent at PropEdge.
    Lead Name: ${lead.name}
    Lead Interest: ${lead.property_interest}
    Properties to pitch: ${propDetails}
    
    Draft a short, highly personalized WhatsApp follow-up message. 
    It should sound natural, professional, and not too "salesy". 
    Include a clear call-to-action (e.g., booking a tour or a 5-minute call).
    Keep it under 150 words.`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();
    
    return { success: true, script: text, matches: properties.slice(0, 2) };
  } catch (err) {
    console.error('Gemini AI Error (Pitch):', err.message);
    return { success: false, error: err.message };
  }
};

/**
 * Generates a professional email structure using Gemini.
 */
const generateEmail = async (scenario, leadName, propertyName) => {
  try {
    if (!apiKey) throw new Error("GEMINI_API_KEY is missing");

    const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });
    const prompt = `Draft a professional real estate email for the following scenario: ${scenario}.
    Client Name: ${leadName}
    Property Reference: ${propertyName || 'the property we discussed'}
    
    Include a clear Subject Line and a professional body with your name as Sarah Al-Rashid from PropEdge.
    Focus on building trust and providing value.`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();
    
    return { success: true, text };
  } catch (err) {
    console.error('Gemini AI Error (Email):', err.message);
    return { success: false, error: err.message };
  }
};

const generateSocialMarketingKit = async (p) => {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });
    const prompt = `Generate a social media marketing kit for this property:
    Name: ${p.name}, Location: ${p.address}, Price: ${p.price}
    Provide Hook, IG Caption, FB Story, LI Post, WA Blast.`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();
    
    return {
      success: true,
      kit: {
        title: p.name,
        instagram: text,
        facebook: text,
        linkedin: text,
        whatsapp: text
      }
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
};

module.exports = { 
  generateDescription, 
  generateSocialMarketingKit, 
  generatePitchScript,
  generateEmail
};
