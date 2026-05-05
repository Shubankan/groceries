const defaultGroceryItems = [
  "Veggies",
  "Cooking Oil",
  "Fruits",
  "Avocado",
  "Milk",
  "Lemonade",
  "Coffee",
  "Hummus",
  "Ground Turkey",
  "Rice",
  "Juice",
  "Bread/Bagels",
  "Slice Cheese",
  "Yogurt",
  "Shredded Cheese",
  "Deli Turkey",
  "Eggs",
  "Snacks"
];

const fileInput = document.querySelector("#photos");
const cameraInput = document.querySelector("#camera-photo");
const mealPlanInput = document.querySelector("#meal-plan");
const addItemForm = document.querySelector("#add-item-form");
const newItemInput = document.querySelector("#new-item");
const previewGrid = document.querySelector("#preview-grid");
const analyzeButton = document.querySelector("#analyze-button");
const helperText = document.querySelector("#helper-text");
const progressPanel = document.querySelector("#analysis-progress");
const progressFill = document.querySelector("#analysis-progress-fill");
const progressPercent = document.querySelector("#analysis-progress-percent");
const photoCount = document.querySelector("#photo-count");
const groceryList = document.querySelector("#grocery-list");
const itemCount = document.querySelector("#item-count");
const results = document.querySelector("#results");
const resetListButton = document.querySelector("#reset-list-button");
const clearRecommendedButton = document.querySelector("#clear-recommended-button");
const maxPhotos = 7;
const progressDurationMs = 15000;

let selectedPhotos = [];
let groceryItems = [...defaultGroceryItems];
let currentAnalysis = null;
let isAnalyzing = false;

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#039;"
  })[character]);
}

function renderGroceryList() {
  itemCount.textContent = `${groceryItems.length} item${groceryItems.length === 1 ? "" : "s"}`;
  groceryList.innerHTML = groceryItems.map((item, index) => `
    <div class="check-item">
      <span class="check-mark">✓</span>
      <span>${escapeHtml(item)}</span>
      <button class="remove-item" type="button" aria-label="Remove ${escapeHtml(item)}" data-index="${index}">×</button>
    </div>
  `).join("");
  updatePhotoState();
}

function updatePhotoState() {
  previewGrid.innerHTML = selectedPhotos.map((photo, index) => `
    <div class="preview-card">
      <img src="${photo.preview}" alt="Uploaded grocery photo ${index + 1}">
      <button class="remove-photo" type="button" aria-label="Remove photo" data-index="${index}">×</button>
    </div>
  `).join("");

  const count = selectedPhotos.length;
  photoCount.textContent = `${count} / ${maxPhotos}`;
  analyzeButton.disabled = isAnalyzing || count < 3 || count > maxPhotos || groceryItems.length < 1;

  if (isAnalyzing) {
    helperText.textContent = "Scanning each photo carefully.";
  } else if (groceryItems.length < 1) {
    helperText.textContent = "Add at least one grocery item to scan for.";
  } else if (count < 3) {
    helperText.textContent = `Add ${3 - count} more photo${3 - count === 1 ? "" : "s"} to begin.`;
  } else if (count > maxPhotos) {
    helperText.textContent = `Keep it to ${maxPhotos} photos or fewer.`;
  } else {
    helperText.textContent = "Ready to find which groceries are needed.";
  }
}

function addGroceryItem(item, options = {}) {
  const cleanItem = item.replace(/\s+/g, " ").trim();
  if (!cleanItem) return;

  const alreadyAdded = groceryItems.some((groceryItem) => (
    groceryItem.toLowerCase() === cleanItem.toLowerCase()
  ));
  if (alreadyAdded) {
    helperText.textContent = `${cleanItem} is already on the scan list.`;
    return;
  }

  groceryItems = [...groceryItems, cleanItem.slice(0, 60)];
  renderGroceryList();
  if (options.hideResults !== false) {
    results.hidden = true;
  }
  return cleanItem;
}

function resetGroceryList() {
  groceryItems = [...defaultGroceryItems];
  renderGroceryList();
  results.hidden = true;
  helperText.textContent = "Scan list reset to the default groceries.";
}

function resizeImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const image = new Image();
      image.onload = () => {
        const maxSide = 900;
        const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(image.width * scale);
        canvas.height = Math.round(image.height * scale);

        const context = canvas.getContext("2d");
        context.drawImage(image, 0, 0, canvas.width, canvas.height);

        resolve(canvas.toDataURL("image/jpeg", 0.7));
      };
      image.onerror = () => reject(new Error("One of the selected files could not be read as an image."));
      image.src = reader.result;
    };
    reader.onerror = () => reject(new Error("Could not read the selected photo."));
    reader.readAsDataURL(file);
  });
}

async function addPhotos(files) {
  if (selectedPhotos.length >= maxPhotos) {
    helperText.textContent = "Remove a photo before adding another.";
    fileInput.value = "";
    cameraInput.value = "";
    return;
  }

  helperText.textContent = "Preparing photos...";
  const remainingSlots = maxPhotos - selectedPhotos.length;
  const incoming = Array.from(files).slice(0, remainingSlots);

  try {
    const photos = await Promise.all(incoming.map(async (file) => {
      const image = await resizeImage(file);
      return {
        image,
        preview: URL.createObjectURL(file)
      };
    }));
    selectedPhotos = [...selectedPhotos, ...photos];
  } catch (error) {
    helperText.textContent = error.message;
  }

  fileInput.value = "";
  cameraInput.value = "";
  updatePhotoState();
}

function normalizeList(items) {
  if (!Array.isArray(items)) {
    return [];
  }
  return items;
}

function sortResultItems(items) {
  return [...items].sort((a, b) => {
    const aIndex = groceryItems.indexOf(a.item);
    const bIndex = groceryItems.indexOf(b.item);
    const safeAIndex = aIndex === -1 ? groceryItems.length : aIndex;
    const safeBIndex = bIndex === -1 ? groceryItems.length : bIndex;
    return safeAIndex - safeBIndex;
  });
}

function sortNeededItems(items) {
  return sortResultItems(items).sort((a, b) => Number(Boolean(a.checked)) - Number(Boolean(b.checked)));
}

function renderResultList(elementId, items, detailKeys, options = {}) {
  const element = document.querySelector(elementId);
  const normalizedItems = normalizeList(items);

  if (normalizedItems.length === 0) {
    element.innerHTML = `<div class="result-empty">None</div>`;
    return;
  }

  element.innerHTML = normalizedItems.map((entry) => {
    const item = typeof entry === "string" ? entry : entry.item || "Item";
    const detail = detailKeys.map((key) => entry[key]).find(Boolean) || "";
    const checked = Boolean(entry.checked);
    const actions = options.actions === "checkNeeded" ? `
      <button class="needed-toggle" type="button" data-needed-item="${escapeHtml(item)}" aria-pressed="${checked}">
        <span class="needed-check" aria-hidden="true">${checked ? "✓" : ""}</span>
        <span>${checked ? "Got it" : "Need it"}</span>
      </button>
    ` : options.actions === "resolveUnsure" ? `
      <div class="resolution-actions" data-item="${escapeHtml(entry.item || "")}">
        <button type="button" data-resolution="need">Need</button>
        <button type="button" data-resolution="dontNeed">Don't Need</button>
        <button type="button" data-resolution="remove">Remove</button>
      </div>
    ` : options.actions === "recommended" ? `
      <div class="recommendation-actions" data-item="${escapeHtml(item)}">
        <button type="button" data-recommendation-action="add">Add</button>
        <button type="button" data-recommendation-action="remove">Remove</button>
      </div>
    ` : "";

    return `
      <div class="result-card${checked ? " is-checked" : ""}">
        <strong>${escapeHtml(item)}</strong>
        ${detail ? `<span>${escapeHtml(detail)}</span>` : ""}
        ${actions}
      </div>
    `;
  }).join("");
}

function renderAnalysisResults() {
  if (!currentAnalysis) return;

  renderResultList("#need-list", sortNeededItems(currentAnalysis.need || []), ["reason"], {
    actions: "checkNeeded"
  });
  renderResultList("#dont-need-list", sortResultItems(currentAnalysis.dontNeed || []), ["evidence", "reason"]);
  renderResultList("#unsure-list", sortResultItems(currentAnalysis.unsure || []), ["reason"], {
    actions: "resolveUnsure"
  });
  renderResultList("#recommended-list", currentAnalysis.recommended || [], ["reason"], {
    actions: "recommended"
  });
  renderResultList("#tips-list", currentAnalysis.quickTips || [], []);
  clearRecommendedButton.hidden = normalizeList(currentAnalysis.recommended).length === 0;
}

function resolveUnsureItem(item, resolution) {
  if (!currentAnalysis || !item) return;

  currentAnalysis.unsure = (currentAnalysis.unsure || []).filter((entry) => entry.item !== item);

  if (resolution === "need") {
    currentAnalysis.need = [
      ...(currentAnalysis.need || []).filter((entry) => entry.item !== item),
      {
        item,
        reason: "Marked as needed by you.",
        checked: false
      }
    ];
  }

  if (resolution === "dontNeed") {
    currentAnalysis.dontNeed = [
      ...(currentAnalysis.dontNeed || []).filter((entry) => entry.item !== item),
      {
        item,
        evidence: "Confirmed by you."
      }
    ];
  }

  renderAnalysisResults();
  helperText.textContent = resolution === "remove"
    ? `${item} removed from unsure.`
    : `${item} moved from unsure.`;
}

function toggleNeededItem(item) {
  if (!currentAnalysis || !item) return;

  currentAnalysis.need = normalizeList(currentAnalysis.need).map((entry) => {
    if (entry.item !== item) return entry;
    return {
      ...entry,
      checked: !entry.checked
    };
  });

  const checkedItem = normalizeList(currentAnalysis.need).find((entry) => entry.item === item);
  renderAnalysisResults();
  helperText.textContent = checkedItem?.checked
    ? `${item} checked off.`
    : `${item} moved back to needed.`;
}

function removeRecommendedItem(item) {
  if (!currentAnalysis || !item) return false;

  const previousLength = normalizeList(currentAnalysis.recommended).length;
  currentAnalysis.recommended = normalizeList(currentAnalysis.recommended).filter((entry) => {
    const recommendedItem = typeof entry === "string" ? entry : entry.item;
    return recommendedItem !== item;
  });

  return currentAnalysis.recommended.length !== previousLength;
}

function handleRecommendedItem(item, action) {
  if (!currentAnalysis || !item) return;

  if (action === "add") {
    const addedItem = addGroceryItem(item, { hideResults: false });
    removeRecommendedItem(item);
    renderAnalysisResults();
    helperText.textContent = addedItem
      ? `${addedItem} added to the scan list.`
      : `${item} is already on the scan list.`;
    return;
  }

  if (action === "remove") {
    removeRecommendedItem(item);
    renderAnalysisResults();
    helperText.textContent = `${item} removed from recommendations.`;
  }
}

function clearRecommendedItems() {
  if (!currentAnalysis) return;

  currentAnalysis.recommended = [];
  renderAnalysisResults();
  helperText.textContent = "Recommended items cleared.";
}

function setProgress(percent) {
  const cleanPercent = Math.max(0, Math.min(100, Math.round(percent)));
  progressFill.style.width = `${cleanPercent}%`;
  progressPercent.textContent = `${cleanPercent}%`;
}

function runFakeProgress() {
  progressPanel.hidden = false;
  setProgress(0);

  let completeProgress;
  const promise = new Promise((resolve) => {
    const startedAt = Date.now();
    let displayedPercent = 0;
    let isComplete = false;

    completeProgress = () => {
      if (isComplete) return;
      isComplete = true;
      setProgress(100);
      resolve();
    };

    const tick = () => {
      if (isComplete) return;

      const elapsed = Date.now() - startedAt;
      const basePercent = Math.min(99, (elapsed / progressDurationMs) * 100);
      const randomLift = Math.random() * 8;

      displayedPercent = Math.max(
        displayedPercent + Math.random() * 3.6,
        Math.min(99, basePercent + randomLift)
      );

      if (elapsed >= progressDurationMs) {
        completeProgress();
        return;
      }

      setProgress(displayedPercent);
      window.setTimeout(tick, 280 + Math.random() * 240);
    };

    window.setTimeout(tick, 220);
  });

  return {
    finish: completeProgress,
    promise
  };
}

async function analyze() {
  if (isAnalyzing) return;

  isAnalyzing = true;
  analyzeButton.disabled = true;
  analyzeButton.textContent = "Checking list...";
  helperText.textContent = "Scanning each photo carefully.";
  results.hidden = true;
  let finalHelperText = "";
  const progress = runFakeProgress();

  try {
    const analysisPromise = fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        images: selectedPhotos.map((photo) => photo.image),
        groceryItems,
        mealPlan: mealPlanInput.value
      })
    }).then(async (response) => {
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Analysis failed.");
      }
      return data;
    });

    const data = await analysisPromise;
    progress.finish();

    currentAnalysis = data.analysis || {};
    renderAnalysisResults();
    results.hidden = false;
    results.scrollIntoView({ behavior: "smooth", block: "start" });
    finalHelperText = `Needed groceries found with ${data.model}.`;
  } catch (error) {
    progress.finish();
    finalHelperText = error.message;
  } finally {
    isAnalyzing = false;
    analyzeButton.textContent = "Find what I need";
    updatePhotoState();
    helperText.textContent = finalHelperText;
    window.setTimeout(() => {
      progressPanel.hidden = true;
      setProgress(0);
    }, 650);
  }
}

fileInput.addEventListener("change", (event) => addPhotos(event.target.files));
cameraInput.addEventListener("change", (event) => addPhotos(event.target.files));
addItemForm.addEventListener("submit", (event) => {
  event.preventDefault();
  addGroceryItem(newItemInput.value);
  newItemInput.value = "";
  newItemInput.focus();
});
groceryList.addEventListener("click", (event) => {
  const button = event.target.closest(".remove-item");
  if (!button) return;

  const index = Number(button.dataset.index);
  groceryItems = groceryItems.filter((_, itemIndex) => itemIndex !== index);
  renderGroceryList();
  results.hidden = true;
});
previewGrid.addEventListener("click", (event) => {
  const button = event.target.closest(".remove-photo");
  if (!button) return;

  const index = Number(button.dataset.index);
  URL.revokeObjectURL(selectedPhotos[index].preview);
  selectedPhotos = selectedPhotos.filter((_, photoIndex) => photoIndex !== index);
  updatePhotoState();
});
document.querySelector("#need-list").addEventListener("click", (event) => {
  const button = event.target.closest("[data-needed-item]");
  if (!button) return;

  toggleNeededItem(button.dataset.neededItem);
});
document.querySelector("#unsure-list").addEventListener("click", (event) => {
  const button = event.target.closest("[data-resolution]");
  if (!button) return;

  const actions = button.closest(".resolution-actions");
  resolveUnsureItem(actions?.dataset.item, button.dataset.resolution);
});
document.querySelector("#recommended-list").addEventListener("click", (event) => {
  const button = event.target.closest("[data-recommendation-action]");
  if (!button) return;

  const actions = button.closest(".recommendation-actions");
  handleRecommendedItem(actions?.dataset.item, button.dataset.recommendationAction);
});
analyzeButton.addEventListener("click", analyze);
resetListButton.addEventListener("click", resetGroceryList);
clearRecommendedButton.addEventListener("click", clearRecommendedItems);

renderGroceryList();
updatePhotoState();
