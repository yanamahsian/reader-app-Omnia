export default {
  async fetch(request, env) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    if (request.method !== "POST") {
      return new Response("Method not allowed", {
        status: 405,
        headers: corsHeaders
      });
    }

    try {
      const body = await request.json();
      const { action, text, targetLanguage } = body || {};

      if (!action || !text) {
        return new Response(
          JSON.stringify({ error: "Missing action or text" }),
          {
            status: 400,
            headers: {
              "Content-Type": "application/json",
              ...corsHeaders
            }
          }
        );
      }

      let prompt = "";

      if (action === "translate") {
        const language = targetLanguage || "English";
        prompt = `
You are a precise literary and philosophical translator.

Translate the following text into ${language}.

Rules:
- Preserve tone and meaning.
- Keep philosophical terms accurate.
- Do not add commentary.
- Return only the translation.

Text:
"""${text}"""
        `.trim();
      } else if (action === "explain") {
        prompt = `
You are an intellectual reading assistant.

Explain the following fragment in clear, elegant, simple Russian.

Rules:
- Explain the meaning faithfully.
- Do not oversimplify too much.
- If there is a philosophical concept, clarify it.
- Keep the answer concise but meaningful.
- Return only the explanation.

Text:
"""${text}"""
        `.trim();
      } else {
        return new Response(
          JSON.stringify({ error: "Unknown action" }),
          {
            status: 400,
            headers: {
              "Content-Type": "application/json",
              ...corsHeaders
            }
          }
        );
      }

      const openaiResponse = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${env.OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model: "gpt-4.1-mini",
          input: prompt
        })
      });

      if (!openaiResponse.ok) {
        const errorText = await openaiResponse.text();
        return new Response(
          JSON.stringify({ error: errorText }),
          {
            status: 500,
            headers: {
              "Content-Type": "application/json",
              ...corsHeaders
            }
          }
        );
      }

      const data = await openaiResponse.json();

      const outputText =
        data.output_text ||
        data.output?.map(item =>
          item.content?.map(c => c.text).join("")
        ).join("\n") ||
        "No response";

      return new Response(
        JSON.stringify({ result: outputText }),
        {
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders
          }
        }
      );
    } catch (error) {
      return new Response(
        JSON.stringify({ error: error.message || "Unknown error" }),
        {
          status: 500,
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders
          }
        }
      );
    }
  }
};
