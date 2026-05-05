const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";

function sendJson(response, statusCode, payload) {
  response.status(statusCode).json(payload);
}

function createAnalysisSchema(groceryList) {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      summary: { type: "string" },
      dontNeed: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            item: { type: "string", enum: groceryList },
            evidence: { type: "string" }
          },
          required: ["item", "evidence"]
        }
      },
      need: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            item: { type: "string" },
            reason: { type: "string" }
          },
          required: ["item", "reason"]
        }
      },
      unsure: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            item: { type: "string", enum: groceryList },
            reason: { type: "string" }
          },
          required: ["item", "reason"]
        }
      },
      quickTips: {
        type: "array",
        items: { type: "string" },
        maxItems: 3
      },
      recommended: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            item: { type: "string" },
            reason: { type: "string" }
          },
          required: ["item", "reason"]
        },
        maxItems: 5
      }
    },
    required: ["summary", "need", "dontNeed", "unsure", "quickTips", "recommended"]
  };
}

function safeJsonFromText(text) {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("The AI response was not valid JSON.");
    return JSON.parse(match[0]);
  }
}

function normalizeGroceryList(items) {
  if (!Array.isArray(items)) return [];

  const uniqueItems = [];
  const seenItems = new Set();
  for (const item of items) {
    if (typeof item !== "string") continue;
    const cleanItem = item.replace(/\s+/g, " ").trim().slice(0, 60);
    const key = cleanItem.toLowerCase();
    if (!cleanItem || seenItems.has(key)) continue;
    seenItems.add(key);
    uniqueItems.push(cleanItem);
  }

  return uniqueItems.slice(0, 40);
}

function normalizeMealPlan(value) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, 100);
}

function normalizeAnalysis(analysis, groceryList) {
  const byItem = new Map();
  const seenNeededItems = new Set();
  const normalized = {
    summary: analysis.summary || "Here is what appears needed from your grocery list.",
    need: [],
    dontNeed: [],
    unsure: [],
    quickTips: Array.isArray(analysis.quickTips) ? analysis.quickTips.slice(0, 3) : [],
    recommended: []
  };

  for (const status of ["need", "dontNeed", "unsure"]) {
    const entries = Array.isArray(analysis[status]) ? analysis[status] : [];
    for (const entry of entries) {
      if (!entry || typeof entry.item !== "string") continue;
      const item = entry.item.replace(/\s+/g, " ").trim().slice(0, 60);
      if (!item) continue;

      if (status === "need") {
        const key = item.toLowerCase();
        if (seenNeededItems.has(key)) continue;
        seenNeededItems.add(key);
        if (groceryList.includes(item)) {
          byItem.set(item, status);
        }
        normalized.need.push({
          item,
          reason: typeof entry.reason === "string"
            ? entry.reason.replace(/\s+/g, " ").trim().slice(0, 180)
            : "Needed."
        });
        continue;
      }

      if (!groceryList.includes(item) || byItem.has(item)) continue;
      byItem.set(item, status);
      normalized[status].push({
        ...entry,
        item
      });
    }
  }

  for (const item of groceryList) {
    if (byItem.has(item)) continue;
    normalized.unsure.push({
      item,
      reason: "The photos did not give enough visual evidence to confidently mark this as stocked or needed."
    });
  }

  normalized.need.sort((a, b) => {
    const aIndex = groceryList.indexOf(a.item);
    const bIndex = groceryList.indexOf(b.item);
    const safeAIndex = aIndex === -1 ? groceryList.length : aIndex;
    const safeBIndex = bIndex === -1 ? groceryList.length : bIndex;
    return safeAIndex - safeBIndex;
  });
  normalized.dontNeed.sort((a, b) => groceryList.indexOf(a.item) - groceryList.indexOf(b.item));
  normalized.unsure.sort((a, b) => groceryList.indexOf(a.item) - groceryList.indexOf(b.item));
  normalized.recommended = normalizeRecommendedItems(analysis.recommended, groceryList);

  return normalized;
}

function normalizeRecommendedItems(items, groceryList) {
  if (!Array.isArray(items)) return [];

  const groceryKeys = new Set(groceryList.map((item) => item.toLowerCase()));
  const seenItems = new Set();
  const normalizedItems = [];

  for (const entry of items) {
    if (!entry || typeof entry.item !== "string") continue;
    const item = entry.item.replace(/\s+/g, " ").trim().slice(0, 60);
    const key = item.toLowerCase();
    if (!item || groceryKeys.has(key) || seenItems.has(key)) continue;
    seenItems.add(key);
    normalizedItems.push({
      item,
      reason: typeof entry.reason === "string"
        ? entry.reason.replace(/\s+/g, " ").trim().slice(0, 140)
        : "Nutrient-dense addition."
    });
  }

  return normalizedItems.slice(0, 5);
}

function parsePayload(request) {
  if (typeof request.body === "string") {
    return JSON.parse(request.body);
  }

  return request.body || {};
}

export default async function handler(request, response) {
  if (request.method !== "POST") {
    sendJson(response, 405, { error: "Method not allowed" });
    return;
  }

  if (!process.env.OPENAI_API_KEY) {
    sendJson(response, 500, {
      error: "Missing OPENAI_API_KEY. Add it in Vercel Project Settings > Environment Variables."
    });
    return;
  }

  let payload;
  try {
    payload = parsePayload(request);
  } catch {
    sendJson(response, 400, { error: "Could not read the uploaded images." });
    return;
  }

  const images = Array.isArray(payload.images) ? payload.images : [];
  const groceryList = normalizeGroceryList(payload.groceryItems);
  const mealPlan = normalizeMealPlan(payload.mealPlan);

  if (images.length < 3 || images.length > 7) {
    sendJson(response, 400, { error: "Upload 3 to 7 fridge, freezer, or pantry photos." });
    return;
  }

  if (groceryList.length < 1) {
    sendJson(response, 400, { error: "Add at least one grocery item to scan for." });
    return;
  }

  if (!images.every((image) => typeof image === "string" && image.startsWith("data:image/"))) {
    sendJson(response, 400, { error: "Every upload must be an image file." });
    return;
  }

  const content = [
    {
      type: "input_text",
      text: [
        "Carefully and patiently analyze these fridge, freezer, and pantry photos against the grocery scan list.",
        "Inspect every visible shelf, drawer, freezer bin, door compartment, pantry area, bag, tub, carton, jar, and package label before deciding.",
        "Pay extra attention to small or partially visible dairy packaging, especially shredded cheese, sliced cheese, mozzarella, yogurt, hummus, milk, eggs, and deli items.",
        "Treat close equivalents as evidence for the requested item when reasonable, for example shredded mozzarella counts as Shredded Cheese.",
        "Treat Avocado as its own separate scan-list item. Do not count avocado as Fruits, and do not count other fruits as Avocado.",
        "Do not confuse alcohol bottles such as prosecco, champagne, wine, beer, or liquor with Cooking Oil. A bottle only counts as Cooking Oil when the label, cap, shape, or surrounding context clearly indicates cooking oil, olive oil, avocado oil, vegetable oil, or similar.",
        "If the photos show sliced meat, lunch meat, cold cuts, or deli packaging but the label does not clearly say turkey, classify Deli Turkey as unsure rather than dontNeed.",
        "Classify every listed item into exactly one category: need, dontNeed, or unsure.",
        "Use dontNeed when the item is clearly visible, readable on packaging, or strongly implied by a visible equivalent, meaning the user should not buy more.",
        "Use need only after checking all photos carefully and finding no convincing visual evidence that the item is stocked.",
        "Use unsure when photo quality, angle, occlusion, or packaging ambiguity prevents a confident decision.",
        "Also recommend up to 5 additional healthy, nutrient-dense grocery items that are not already on the grocery scan list and are not visibly stocked in the photos. Favor practical fridge/freezer/pantry staples such as leafy greens, berries, beans, lentils, tofu, salmon, nuts, seeds, kefir, or similar whole foods.",
        mealPlan
          ? `The user is planning to cook: ${mealPlan}. Identify the practical core ingredients for that meal. If any required meal ingredient is not clearly visible in the photos, add it to the need array, even when it is not already on the grocery scan list. Keep these meal additions specific, grocery-store friendly, and avoid adding optional garnishes unless they are central to the dish.`
          : "No planned meal was provided.",
        "For the original grocery scan list, classify each listed item exactly once into need, dontNeed, or unsure. Extra items are only allowed in need when they are missing ingredients for the planned meal.",
        `Grocery scan list: ${groceryList.join(", ")}`
      ].join("\n")
    },
    ...images.map((image) => ({
      type: "input_image",
      image_url: image,
      detail: "high"
    }))
  ];

  try {
    const aiResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        input: [
          {
            role: "user",
            content
          }
        ],
        text: {
          format: {
            type: "json_schema",
            name: "grocery_photo_analysis",
            schema: createAnalysisSchema(groceryList),
            strict: true
          }
        },
        max_output_tokens: 1400
      })
    });

    const data = await aiResponse.json();
    if (!aiResponse.ok) {
      sendJson(response, aiResponse.status, {
        error: data.error?.message || "OpenAI could not analyze these images."
      });
      return;
    }

    const text = data.output_text || data.output?.flatMap((item) => item.content || [])
      .filter((item) => item.type === "output_text")
      .map((item) => item.text)
      .join("\n");

    const analysis = normalizeAnalysis(safeJsonFromText(text || "{}"), groceryList);
    sendJson(response, 200, {
      groceryList,
      analysis,
      model: OPENAI_MODEL
    });
  } catch (error) {
    sendJson(response, 500, { error: error.message || "Something went wrong during analysis." });
  }
}
