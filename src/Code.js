/***** CONFIG *****/
const TEMPLATE_FORM_ID = ""; // '' to disable
const MAKE_PUBLIC_ANYONE_WITH_LINK = true; // set false if you only want your domain/responders list

/***** MENU *****/
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("Form Builder")
    .addItem("Create Form (Confirm)", "confirmAndCreateForm")
    .addItem("Create MCQ-Only Quiz (Confirm)", "confirmAndCreateMCQOnlyForm")
    .addItem("Create Form & Post to Classroom", "confirmCreateAndPostToClassroom")
    .addItem("Create MCQ-Only Quiz & Post to Classroom", "confirmCreateMCQOnlyAndPostToClassroom")
    .addSeparator()
    .addItem("Post Last Form to Classroom", "postLastFormToClassroom")
    .addToUi();
}

/***** ENTRYPOINTS *****/
function confirmAndCreateForm() {
  const ui = SpreadsheetApp.getUi();
  const res = ui.alert(
    "Create Form",
    "Create a new Google Form quiz and link responses to this spreadsheet (new tab)?",
    ui.ButtonSet.OK_CANCEL
  );
  if (res !== ui.Button.OK) return;

  try {
    const result = createFormFromActiveSpreadsheet({ mcqOnly: false });
    storeLastFormResult(result);
    SpreadsheetApp.getActive().toast("Form created successfully.", "Form Builder", 5);
    ui.alert(
      "Success",
      "Form created. Responses will be stored in this spreadsheet (new tab).\n\n" +
        "Form (student link):\n" + result.publishedUrl + "\n\n" +
        "Form (edit link):\n" + result.editUrl + "\n\n" +
        "Responses (this file):\n" + result.responsesUrl + "\n",
      ui.ButtonSet.OK
    );
  } catch (e) {
    SpreadsheetApp.getActive().toast("Form creation failed.", "Form Builder", 5);
    ui.alert("Error", e && e.message ? e.message : String(e), ui.ButtonSet.OK);
  }
}

function confirmAndCreateMCQOnlyForm() {
  const ui = SpreadsheetApp.getUi();
  const res = ui.alert(
    "Create MCQ-Only Quiz",
    "This will create a Google Form quiz using ONLY MCQ questions (auto-graded).\n\nContinue?",
    ui.ButtonSet.OK_CANCEL
  );
  if (res !== ui.Button.OK) return;

  try {
    const result = createFormFromActiveSpreadsheet({ mcqOnly: true });
    storeLastFormResult(result);
    SpreadsheetApp.getActive().toast("MCQ-only quiz created successfully.", "Form Builder", 5);
    ui.alert(
      "Success",
      "MCQ-only quiz created.\n\n" +
        "Form (student link):\n" + result.publishedUrl + "\n\n" +
        "Form (edit link):\n" + result.editUrl + "\n\n" +
        "Responses (this file):\n" + result.responsesUrl + "\n",
      ui.ButtonSet.OK
    );
  } catch (e) {
    SpreadsheetApp.getActive().toast("MCQ-only form creation failed.", "Form Builder", 5);
    ui.alert("Error", e && e.message ? e.message : String(e), ui.ButtonSet.OK);
  }
}

function confirmCreateAndPostToClassroom() {
  const ui = SpreadsheetApp.getUi();
  const res = ui.alert(
    "Create Form & Post to Classroom",
    "Create a new Google Form quiz, link responses to this spreadsheet, and then post it to Google Classroom?",
    ui.ButtonSet.OK_CANCEL
  );
  if (res !== ui.Button.OK) return;

  try {
    const result = createFormFromActiveSpreadsheet({ mcqOnly: false });
    storeLastFormResult(result);
    SpreadsheetApp.getActive().toast("Form created. Opening Classroom dialog...", "Form Builder", 3);
    showClassroomDialog();
  } catch (e) {
    SpreadsheetApp.getActive().toast("Form creation failed.", "Form Builder", 5);
    ui.alert("Error", e && e.message ? e.message : String(e), ui.ButtonSet.OK);
  }
}

function confirmCreateMCQOnlyAndPostToClassroom() {
  const ui = SpreadsheetApp.getUi();
  const res = ui.alert(
    "Create MCQ-Only Quiz & Post to Classroom",
    "Create an MCQ-only auto-graded quiz (MCQ only) and then post it to Classroom?",
    ui.ButtonSet.OK_CANCEL
  );
  if (res !== ui.Button.OK) return;

  try {
    const result = createFormFromActiveSpreadsheet({ mcqOnly: true });
    storeLastFormResult(result);
    SpreadsheetApp.getActive().toast("MCQ-only quiz created. Opening Classroom dialog...", "Form Builder", 3);
    showClassroomDialog();
  } catch (e) {
    SpreadsheetApp.getActive().toast("MCQ-only creation failed.", "Form Builder", 5);
    ui.alert("Error", e && e.message ? e.message : String(e), ui.ButtonSet.OK);
  }
}

/***** CORE LOGIC (Section, Question, Type, Points, AnswerA..D) *****/
function createFormFromActiveSpreadsheet(options) {
  options = options || {};
  const mcqOnly = !!options.mcqOnly;

  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // Find a sheet with our header
  let sh = ss.getActiveSheet();
  let values = sh.getDataRange().getDisplayValues();
  let cfg = findConfig(values);
  if (!cfg) {
    for (const s of ss.getSheets()) {
      const v = s.getDataRange().getDisplayValues();
      const c = findConfig(v);
      if (c) {
        sh = s;
        values = v;
        cfg = c;
        break;
      }
    }
  }
  if (!cfg)
    throw new Error(
      "Header row not found. Expected columns: Section, Question, Type, Points, AnswerA..D"
    );

  const { formTitle = "Untitled Quiz", formDescription = "", limitOneResponse, headerRowIndex } = cfg;

  // Column indexes (by name)
  const header = values[headerRowIndex].map(String);
  const idx = headerIndex(header, [
    "Section",
    "Question",
    "Type",
    "Points",
    "AnswerA",
    "AnswerB",
    "AnswerC",
    "AnswerD",
  ]);

  // Optional columns (question image + answer image mode)
  const optIdx = optionalHeaderIndex(header, [
    "ImageURL",
    "AnswerAImageURL",
    "AnswerBImageURL",
    "AnswerCImageURL",
    "AnswerDImageURL",
  ]);

  // Section totals for headers
  const sectionTotals = computeSectionTotals(values, headerRowIndex, idx);

  // 1) Create shell (template copy or fresh)
  const form = createFormShell(formTitle, formDescription, ss.getId());
  const formId = form.getId();

  // 2) Destination + basic settings
  form.setIsQuiz(true);

  // Identity / tracking:
  form.setCollectEmail(true);
  if (parseBool(limitOneResponse, false)) form.setLimitOneResponsePerUser(true);
  form.setProgressBar(true);

  // Link responses to THIS spreadsheet
  try {
    form.setDestination(FormApp.DestinationType.SPREADSHEET, ss.getId());
  } catch (_) {
    Utilities.sleep(400);
    form.setDestination(FormApp.DestinationType.SPREADSHEET, ss.getId());
  }

  // Student details section
  form.addSectionHeaderItem()
    .setTitle("Student Details")
    .setHelpText("Please enter your name before you begin.");
  form.addTextItem().setTitle("Student Name").setRequired(true);

  // 3) Build questions
  let currentSection = null;
  for (let r = headerRowIndex + 1; r < values.length; r++) {
    const row = values[r];
    if (!row || row.length === 0 || row.every((v) => v === "" || v == null)) continue;

    const section = (row[idx.Section] || "").toString().trim();
    const question = (row[idx.Question] || "").toString().trim();
    const type = (row[idx.Type] || "").toString().trim().toUpperCase();
    const pts = Number((row[idx.Points] || "").toString().trim()) || 0;

    // ✅ MCQ-only mode: skip anything not MCQ
    if (mcqOnly && type !== "MCQ") continue;

    const rawAns = [
      (row[idx.AnswerA] || "").toString().trim(),
      (row[idx.AnswerB] || "").toString().trim(),
      (row[idx.AnswerC] || "").toString().trim(),
      (row[idx.AnswerD] || "").toString().trim(),
    ];
    const rawAnsImageUrls = [
      getOptionalCell(row, optIdx.AnswerAImageURL),
      getOptionalCell(row, optIdx.AnswerBImageURL),
      getOptionalCell(row, optIdx.AnswerCImageURL),
      getOptionalCell(row, optIdx.AnswerDImageURL),
    ];
    const hasAnswerImages = rawAnsImageUrls.some(Boolean);
    const questionImageUrl = getOptionalCell(row, optIdx.ImageURL);

    if (!section) throw new Error(`Missing "Section" in row ${r + 1} on sheet "${sh.getName()}"`);
    if (!type) throw new Error(`Missing "Type" in row ${r + 1} on sheet "${sh.getName()}"`);
    if (!question) throw new Error(`Missing "Question" in row ${r + 1} on sheet "${sh.getName()}"`);

    if (section !== currentSection) {
      currentSection = section;
      const total = sectionTotals[section] || 0;
      form.addPageBreakItem()
        .setTitle(`${section} Section — ${total} pts total`)
        .setHelpText("Answer all questions. Marks vary.");
    }

    const title = pts > 0 ? `${question}  (${pts} pts)` : question;

    switch (type) {
      case "SA": {
        const item = form.addTextItem().setTitle(title).setRequired(true);
        safeSetPoints(item, pts);
        if (questionImageUrl) addQuestionImageItem(form, question, questionImageUrl, r + 1);
        break;
      }
      case "PARA": {
        const item = form.addParagraphTextItem().setTitle(title).setRequired(true);
        safeSetPoints(item, pts);
        if (questionImageUrl) addQuestionImageItem(form, question, questionImageUrl, r + 1);
        break;
      }
      case "MCQ": {
        // ✅ FIX: MCQ correct answer comes from "*"
        const mcqData = buildAnswerEntries(rawAns, rawAnsImageUrls, "MCQ");
        const entries = mcqData.entries;
        if (entries.length < 2) {
          const item = form.addTextItem().setTitle(title).setRequired(true);
          safeSetPoints(item, pts);
          break;
        }

        const mcq = form.addMultipleChoiceItem().setTitle(title).setRequired(true);
        let formChoices = entries.map((entry) =>
          mcq.createChoice(formatChoiceText(entry, hasAnswerImages), entry.isCorrect)
        );

        if (formChoices.length > 1) formChoices = shuffleArrayCopy(formChoices);
        mcq.setChoices(formChoices);
        safeSetPoints(mcq, pts);

        if (questionImageUrl) addQuestionImageItem(form, question, questionImageUrl, r + 1);
        if (hasAnswerImages) addAnswerImageItems(form, rawAns, rawAnsImageUrls, r + 1);
        break;
      }
      case "MSQ": {
        const msqData = buildAnswerEntries(rawAns, rawAnsImageUrls, "MSQ");
        const cleaned = msqData.entries;
        if (cleaned.length < 2) {
          const item = form.addTextItem().setTitle(title).setRequired(true);
          safeSetPoints(item, pts);
          break;
        }

        const cb = form.addCheckboxItem().setTitle(title).setRequired(true);
        let formChoices = cleaned.map((entry) =>
          cb.createChoice(formatChoiceText(entry, hasAnswerImages), entry.isCorrect)
        );
        formChoices = shuffleArrayCopy(formChoices);
        cb.setChoices(formChoices);
        safeSetPoints(cb, pts);

        if (questionImageUrl) addQuestionImageItem(form, question, questionImageUrl, r + 1);
        if (hasAnswerImages) addAnswerImageItems(form, rawAns, rawAnsImageUrls, r + 1);
        break;
      }
      default:
        throw new Error(`Unsupported Type "${type}" in row ${r + 1}. Use SA, PARA, MCQ, or MSQ.`);
    }
  }

  form.setAllowResponseEdits(false);
  form.setShuffleQuestions(false);

  Utilities.sleep(400);

  // Move near the spreadsheet (best effort)
  try {
    moveFormNextToSpreadsheet(formId, ss.getId());
  } catch (_) {}

  // Publish and set "Anyone with link" if configured
  const urls = ensurePublishedAndOpen(form);

  if (MAKE_PUBLIC_ANYONE_WITH_LINK) {
    try {
      setAnyoneWithLinkResponder(formId);
    } catch (e) {
      Logger.log("setAnyoneWithLinkResponder: " + e);
    }
  }

  return {
    formId: formId,
    formTitle: formTitle,
    publishedUrl: urls.publishedUrl,
    editUrl: urls.editUrl,
    responsesUrl: ss.getUrl(),
  };
}

/***** CREATE FORM FROM TEMPLATE (or new) *****/
function createFormShell(formTitle, formDescription, spreadsheetId) {
  let form;
  if (TEMPLATE_FORM_ID) {
    const templateFile = DriveApp.getFileById(TEMPLATE_FORM_ID);
    const copyFile = templateFile.makeCopy(formTitle);
    const newId = copyFile.getId();
    form = FormApp.openById(newId);
    Utilities.sleep(300);

    // Clear template items (keep theme/settings)
    form.getItems().forEach((it) => form.deleteItem(it));

    form.setTitle(formTitle).setDescription(formDescription);

    try {
      moveFormNextToSpreadsheet(newId, spreadsheetId);
    } catch (_) {}
  } else {
    form = FormApp.create(formTitle).setDescription(formDescription).setIsQuiz(true);
  }
  return form;
}

/***** PUBLISH + RETURN STABLE URL *****/
function ensurePublishedAndOpen(form) {
  try {
    form.setAcceptingResponses(true);
  } catch (_) {}

  for (let i = 0; i < 3; i++) {
    try {
      form.setPublished(true);
      if (form.isPublished()) break;
    } catch (e) {
      Utilities.sleep(300);
    }
  }

  Utilities.sleep(400);

  let publishedUrl = "";
  for (let i = 0; i < 20; i++) {
    try {
      publishedUrl = form.getPublishedUrl();
      if (publishedUrl && /\/forms\/d\/e\//.test(publishedUrl)) break;
    } catch (e) {}
    Utilities.sleep(250);
  }
  if (!publishedUrl) {
    publishedUrl = `https://docs.google.com/forms/d/${form.getId()}/viewform`;
  }

  const editUrl = form.getEditUrl();
  return { publishedUrl, editUrl };
}

/***** “Anyone with the link can respond” *****/
function setAnyoneWithLinkResponder(formId) {
  const body = { type: "anyone", role: "reader", view: "published" };

  try {
    if (Drive.Permissions && typeof Drive.Permissions.create === "function") {
      Drive.Permissions.create({
        fileId: formId,
        resource: body,
        supportsAllDrives: true,
      });
      return;
    }
  } catch (e) {
    Logger.log("Drive.Permissions.create failed, will try insert: " + e);
  }
  try {
    if (Drive.Permissions && typeof Drive.Permissions.insert === "function") {
      Drive.Permissions.insert(body, formId, { supportsAllDrives: true });
      return;
    }
  } catch (e2) {
    Logger.log("Drive.Permissions.insert failed: " + e2);
    throw e2;
  }
}

/***** CONFIG / HEADER HELPERS *****/
function findConfig(values) {
  if (!values || !values.length) return null;
  let formTitle = "",
    formDescription = "",
    limitOneResponse = "";
  let headerRowIndex = -1;

  for (let r = 0; r < values.length; r++) {
    const k = (values[r][0] || "").toString().trim().toLowerCase();
    if (!k) continue;

    if (k === "formtitle") {
      formTitle = (values[r][1] || "").toString().trim() || formTitle;
      continue;
    }
    if (k === "formdescription") {
      formDescription = (values[r][1] || "").toString().trim();
      continue;
    }
    if (k === "limitoneresponse") {
      limitOneResponse = (values[r][1] || "").toString().trim();
      continue;
    }

    const row = values[r].map((x) => (x || "").toString().trim().toLowerCase());
    if (row.includes("section") && row.includes("question") && row.includes("type") && row.includes("points")) {
      headerRowIndex = r;
      break;
    }
  }
  if (headerRowIndex === -1) return null;
  return { formTitle, formDescription, limitOneResponse, headerRowIndex };
}

function headerIndex(headerRow, requiredCols) {
  const idx = {};
  requiredCols.forEach((col) => {
    const i = headerRow.findIndex(
      (h) => h.toString().trim().toLowerCase() === col.toLowerCase()
    );
    if (i === -1) throw new Error(`Header "${col}" not found. Got: ${headerRow.join(", ")}`);
    idx[col] = i;
  });
  return idx;
}

/***** SECTION POINTS *****/
function computeSectionTotals(values, headerRowIndex, idx) {
  const totals = {};
  for (let r = headerRowIndex + 1; r < values.length; r++) {
    const row = values[r];
    if (!row || row.length === 0 || row.every((v) => v === "" || v == null)) continue;
    const section = (row[idx.Section] || "").toString().trim();
    const pts = Number((row[idx.Points] || "").toString().trim()) || 0;
    if (!section) continue;
    totals[section] = (totals[section] || 0) + pts;
  }
  return totals;
}

/***** UTILITIES *****/
function stripStar(s) {
  return s.replace(/^\s*\*/, "").trim();
}
function isStarred(s) {
  return /^\s*\*/.test(s);
}
function parseBool(s, fallback) {
  if (s == null || s === "") return fallback;
  switch (String(s).trim().toLowerCase()) {
    case "true":
    case "yes":
    case "y":
    case "1":
      return true;
    case "false":
    case "no":
    case "n":
    case "0":
      return false;
    default:
      return fallback;
  }
}
function shuffleArrayCopy(list) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function safeSetPoints(item, pts) {
  if (!pts || pts <= 0) return;
  try {
    item.setPoints(pts);
  } catch (_) {}
}

/***** OPTIONAL COLUMN HELPERS *****/
function optionalHeaderIndex(headerRow, cols) {
  const idx = {};
  cols.forEach(function (col) {
    const i = headerRow.findIndex(function (h) {
      return h.toString().trim().toLowerCase() === col.toLowerCase();
    });
    if (i !== -1) idx[col] = i;
  });
  return idx;
}
function getOptionalCell(row, index) {
  if (index === undefined) return "";
  return (row[index] || "").toString().trim();
}

/***** ✅ FIXED ANSWER LOGIC (MCQ uses *) *****/
function buildAnswerEntries(rawAns, rawAnsImageUrls, type) {
  const entries = [];
  const seen = new Set();

  for (let i = 0; i < rawAns.length; i++) {
    const raw = (rawAns[i] || "").toString().trim();
    const imageUrl = (rawAnsImageUrls[i] || "").toString().trim();
    if (!raw && !imageUrl) continue;

    const label = String.fromCharCode(65 + i);
    const text = stripStar(raw) || `Option ${label}`;
    const dedupeKey = `${text.toLowerCase()}|${imageUrl}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    entries.push({
      label,
      text,
      imageUrl,
      isCorrect: isStarred(raw), // ✅ star marks correct (MCQ + MSQ)
    });
  }

  if (entries.length === 0) {
    return { entries, hasExplicitCorrectChoices: false };
  }

  const hasExplicitCorrectChoices = entries.some((e) => e.isCorrect);

  // If no one marked correct, default first option correct (fallback)
  if (!hasExplicitCorrectChoices) {
    entries.forEach((e, idx) => (e.isCorrect = idx === 0));
  }

  // MCQ must have exactly one correct: keep the first correct only
  if (type === "MCQ") {
    const firstCorrectIndex = entries.findIndex((e) => e.isCorrect);
    entries.forEach((e, idx) => (e.isCorrect = idx === firstCorrectIndex));
  }

  return { entries, hasExplicitCorrectChoices };
}

function formatChoiceText(entry, hasAnswerImages) {
  if (!hasAnswerImages) return entry.text;
  return `${entry.label}`;
}

/***** IMAGE HELPERS (OPTIONAL) *****/
function addAnswerImageItems(form, rawAns, rawAnsImageUrls, rowNumber) {
  for (let i = 0; i < rawAnsImageUrls.length; i++) {
    const imageUrl = (rawAnsImageUrls[i] || "").toString().trim();
    if (!imageUrl) continue;

    const label = String.fromCharCode(65 + i);
    const answerText = stripStar((rawAns[i] || "").toString().trim()) || `Option ${label}`;
    try {
      const blob = fetchImageBlobFromUrl(imageUrl);
      form.addImageItem().setTitle(`${label}. ${answerText}`).setImage(blob);
    } catch (imgErr) {
      Logger.log(`Answer image fetch failed row ${rowNumber}, ${label}: ${imgErr}`);
    }
  }
}
function addQuestionImageItem(form, question, imageUrl, rowNumber) {
  try {
    const blob = fetchImageBlobFromUrl(imageUrl);
    form.addImageItem().setTitle("Image for: " + question).setImage(blob);
  } catch (imgErr) {
    Logger.log(`Question image fetch failed row ${rowNumber}: ${imgErr}`);
  }
}
function fetchImageBlobFromUrl(imageUrl) {
  const normalized = (imageUrl || "").toString().trim();
  if (!normalized) throw new Error("Empty image URL");

  const driveFileId = extractDriveFileId(normalized);
  if (driveFileId) {
    const driveBlob = DriveApp.getFileById(driveFileId).getBlob();
    return driveBlob;
  }

  const response = UrlFetchApp.fetch(normalized, {
    followRedirects: false,
    muteHttpExceptions: true,
  });
  const status = response.getResponseCode();
  if (status < 200 || status >= 300) {
    throw new Error(`Image fetch failed with HTTP ${status}`);
  }

  const blob = response.getBlob();
  return blob;
}
function extractDriveFileId(url) {
  const value = (url || "").toString();
  const patterns = [
    /drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/,
    /drive\.google\.com\/open\?id=([a-zA-Z0-9_-]+)/,
    /drive\.google\.com\/uc\?.*id=([a-zA-Z0-9_-]+)/,
    /docs\.google\.com\/uc\?.*id=([a-zA-Z0-9_-]+)/,
  ];
  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (match && match[1]) return match[1];
  }
  return "";
}

/***** MOVE HELPERS *****/
function moveFormNextToSpreadsheet(formId, spreadsheetId) {
  try {
    if (typeof Drive !== "undefined" && Drive.Files) {
      const src = Drive.Files.get(spreadsheetId, { supportsAllDrives: true });
      const dst = Drive.Files.get(formId, { supportsAllDrives: true });
      const srcParents = parentsToIds(src.parents);
      const dstParents = parentsToIds(dst.parents);
      if (srcParents.length) {
        const params = { addParents: srcParents.join(","), supportsAllDrives: true };
        if (dstParents.length) params.removeParents = dstParents.join(",");
        Drive.Files.update({}, formId, null, params);
        return;
      }
    }
  } catch (e) {
    Logger.log("Advanced Drive move failed: " + e);
  }
  try {
    const file = DriveApp.getFileById(formId);
    const ssFile = DriveApp.getFileById(spreadsheetId);
    const parents = ssFile.getParents();
    if (parents.hasNext()) file.moveTo(parents.next());
  } catch (e2) {
    Logger.log("DriveApp move failed; leaving form in root: " + e2);
  }
}
function parentsToIds(parents) {
  if (!parents || !parents.length) return [];
  return typeof parents[0] === "string" ? parents.slice() : parents.map((p) => p.id);
}

/***** GOOGLE CLASSROOM INTEGRATION *****/
function storeLastFormResult(result) {
  const props = PropertiesService.getUserProperties();
  props.setProperty("LAST_FORM_PUBLISHED_URL", result.publishedUrl || "");
  props.setProperty("LAST_FORM_EDIT_URL", result.editUrl || "");
  props.setProperty("LAST_FORM_TITLE", result.formTitle || "Untitled Quiz");
  props.setProperty("LAST_FORM_ID", result.formId || "");
}
function getLastFormResult() {
  const props = PropertiesService.getUserProperties();
  return {
    publishedUrl: props.getProperty("LAST_FORM_PUBLISHED_URL") || "",
    editUrl: props.getProperty("LAST_FORM_EDIT_URL") || "",
    formTitle: props.getProperty("LAST_FORM_TITLE") || "",
    formId: props.getProperty("LAST_FORM_ID") || "",
  };
}
function postLastFormToClassroom() {
  const ui = SpreadsheetApp.getUi();
  const last = getLastFormResult();
  if (!last.publishedUrl) {
    ui.alert(
      "No Form Found",
      "No form has been created yet from this spreadsheet.\nPlease use 'Create Form (Confirm)' first.",
      ui.ButtonSet.OK
    );
    return;
  }
  showClassroomDialog();
}
function showClassroomDialog() {
  const html = HtmlService.createHtmlOutput(getClassroomDialogHtml())
    .setWidth(480)
    .setHeight(560)
    .setTitle("Post to Google Classroom");
  SpreadsheetApp.getUi().showModalDialog(html, "Post to Google Classroom");
}
function getActiveCourses() {
  const courses = [];
  let pageToken = null;
  do {
    const params = { teacherId: "me", courseStates: ["ACTIVE"] };
    if (pageToken) params.pageToken = pageToken;
    const response = Classroom.Courses.list(params);
    if (response.courses) {
      response.courses.forEach(function (c) {
        courses.push({ id: c.id, name: c.name, section: c.section || "" });
      });
    }
    pageToken = response.nextPageToken;
  } while (pageToken);
  return courses;
}
function getTopicsForCourse(courseId) {
  try {
    const response = Classroom.Courses.Topics.list(courseId);
    return (response.topic || []).map(function (t) {
      return { id: t.topicId, name: t.name };
    });
  } catch (e) {
    Logger.log("getTopicsForCourse: " + e);
    return [];
  }
}
function submitToClassroom(options) {
  const last = getLastFormResult();
  if (!last.publishedUrl) throw new Error("No form URL found. Create a form first.");

  const courseId = options.courseId;
  if (!courseId) throw new Error("No course selected.");
  const postType = options.postType || "assignment";
  const title = options.title || last.formTitle || "Untitled Quiz";
  const description = options.description || "";
  let maxPoints = Number(options.maxPoints);
  if (Number.isNaN(maxPoints) || maxPoints < 0) maxPoints = 100;
  const dueDate = options.dueDate || "";
  const dueTime = options.dueTime || "23:59";
  const topicId = options.topicId || "";

  if (postType === "material") {
    const material = {
      title: title,
      description: description,
      state: "PUBLISHED",
      materials: [{ link: { url: last.publishedUrl } }],
    };
    if (topicId) material.topicId = topicId;
    Classroom.Courses.CourseWorkMaterials.create(material, courseId);
  } else {
    const courseWork = {
      title: title,
      description: description,
      workType: "ASSIGNMENT",
      state: "PUBLISHED",
      materials: [{ link: { url: last.publishedUrl } }],
      maxPoints: maxPoints,
    };
    if (topicId) courseWork.topicId = topicId;

    if (dueDate) {
      const [yearStr, monthStr, dayStr] = dueDate.split("-");
      const year = Number(yearStr);
      const month = Number(monthStr);
      const day = Number(dayStr);
      if (Number.isNaN(year) || Number.isNaN(month) || Number.isNaN(day)) {
        throw new Error("Invalid due date format. Expected YYYY-MM-DD.");
      }
      courseWork.dueDate = { year: year, month: month, day: day };

      const parts = dueTime.split(":").map(Number);
      const hours = Number.isNaN(parts[0]) ? 23 : parts[0];
      const minutes = Number.isNaN(parts[1]) ? 59 : parts[1];
      courseWork.dueTime = { hours: hours, minutes: minutes };
    }

    Classroom.Courses.CourseWork.create(courseWork, courseId);
  }

  return { success: true, message: 'Posted "' + title + '" to Google Classroom successfully.' };
}

/***** HTML DIALOG *****/
function getClassroomDialogHtml() {
  const last = getLastFormResult();
  const escapedTitle = escapeHtml(last.formTitle || "Untitled Quiz");
  const escapedUrl = escapeHtml(last.publishedUrl || "(no URL)");
  return (
    "<!DOCTYPE html>" +
    '<html><head><base target="_top">' +
    "<style>" +
    "body{font-family:Arial,sans-serif;padding:16px;margin:0;font-size:14px}" +
    "label{display:block;margin:10px 0 4px;font-weight:bold;font-size:13px}" +
    "select,input{width:100%;padding:7px;box-sizing:border-box;border:1px solid #dadce0;border-radius:4px;font-size:13px}" +
    ".row{margin-bottom:4px}" +
    ".actions{margin-top:16px;text-align:right}" +
    "button{padding:8px 20px;margin-left:8px;cursor:pointer;font-size:13px}" +
    ".primary{background:#1a73e8;color:#fff;border:none;border-radius:4px}" +
    ".primary:hover{background:#1557b0}" +
    ".secondary{background:#f1f3f4;border:1px solid #dadce0;border-radius:4px}" +
    "#status{margin-top:12px;padding:8px;border-radius:4px;display:none}" +
    ".success{background:#e6f4ea;color:#137333}" +
    ".error{background:#fce8e6;color:#c5221f}" +
    ".info{background:#e8f0fe;color:#1967d2}" +
    ".form-url{font-size:12px;color:#666;word-break:break-all;margin-bottom:8px;padding:8px;background:#f8f9fa;border-radius:4px}" +
    "</style>" +
    "</head><body>" +
    '<div class="form-url"><strong>Form:</strong> ' +
    escapedTitle +
    "<br>" +
    escapedUrl +
    "</div>" +
    '<div id="loading" class="info" style="display:block;padding:8px;border-radius:4px">Loading courses...</div>' +
    '<div id="formArea" style="display:none">' +
    '<div class="row">' +
    '<label for="course">Course</label>' +
    '<select id="course" onchange="loadTopics()"><option value="">-- Select a course --</option></select>' +
    "</div>" +
    '<div class="row">' +
    '<label for="postType">Post As</label>' +
    '<select id="postType" onchange="toggleFields()">' +
    '<option value="assignment">Quiz Assignment (graded)</option>' +
    '<option value="material">Class Material (ungraded)</option>' +
    "</select>" +
    "</div>" +
    '<div class="row">' +
    '<label for="title">Title</label>' +
    '<input type="text" id="title" value="' +
    escapedTitle +
    '">' +
    "</div>" +
    '<div class="row">' +
    '<label for="description">Description (optional)</label>' +
    '<input type="text" id="description" placeholder="Instructions for students...">' +
    "</div>" +
    '<div id="assignmentFields">' +
    '<div class="row">' +
    '<label for="maxPoints">Max Points</label>' +
    '<input type="number" id="maxPoints" value="100" min="0">' +
    "</div>" +
    '<div class="row">' +
    '<label for="dueDate">Due Date (optional)</label>' +
    '<input type="date" id="dueDate">' +
    "</div>" +
    '<div class="row">' +
    '<label for="dueTime">Due Time</label>' +
    '<input type="time" id="dueTime" value="23:59">' +
    "</div>" +
    "</div>" +
    '<div class="row">' +
    '<label for="topic">Topic (optional)</label>' +
    '<select id="topic"><option value="">-- None --</option></select>' +
    "</div>" +
    '<div class="actions">' +
    '<button class="secondary" onclick="google.script.host.close()">Cancel</button>' +
    '<button class="primary" id="submitBtn" onclick="submit()">Post to Classroom</button>' +
    "</div>" +
    "</div>" +
    '<div id="status"></div>' +
    "<script>" +
    "function init(){" +
    "google.script.run.withSuccessHandler(function(courses){" +
    "var sel=document.getElementById('course');" +
    "courses.forEach(function(c){" +
    "var o=document.createElement('option');" +
    "o.value=c.id;" +
    "o.textContent=c.name+(c.section?' - '+c.section:'');" +
    "sel.appendChild(o);" +
    "});" +
    "document.getElementById('loading').style.display='none';" +
    "document.getElementById('formArea').style.display='block';" +
    "}).withFailureHandler(function(e){" +
    "showStatus('Failed to load courses: '+e.message,'error');" +
    "document.getElementById('loading').style.display='none';" +
    "}).getActiveCourses();" +
    "}" +
    "function loadTopics(){" +
    "var courseId=document.getElementById('course').value;" +
    "var sel=document.getElementById('topic');" +
    "sel.innerHTML='<option value=\"\">-- None --</option>';" +
    "if(!courseId)return;" +
    "google.script.run.withSuccessHandler(function(topics){" +
    "topics.forEach(function(t){" +
    "var o=document.createElement('option');" +
    "o.value=t.id;" +
    "o.textContent=t.name;" +
    "sel.appendChild(o);" +
    "});" +
    "}).getTopicsForCourse(courseId);" +
    "}" +
    "function toggleFields(){" +
    "var t=document.getElementById('postType').value;" +
    "document.getElementById('assignmentFields').style.display=(t==='assignment')?'block':'none';" +
    "}" +
    "function submit(){" +
    "var courseId=document.getElementById('course').value;" +
    "if(!courseId){showStatus('Please select a course.','error');return;}" +
    "var opts={" +
    "courseId:courseId," +
    "postType:document.getElementById('postType').value," +
    "title:document.getElementById('title').value," +
    "description:document.getElementById('description').value," +
    "maxPoints:document.getElementById('maxPoints').value," +
    "dueDate:document.getElementById('dueDate').value," +
    "dueTime:document.getElementById('dueTime').value," +
    "topicId:document.getElementById('topic').value" +
    "};" +
    "document.getElementById('submitBtn').disabled=true;" +
    "document.getElementById('submitBtn').textContent='Posting...';" +
    "showStatus('Posting to Classroom...','info');" +
    "google.script.run.withSuccessHandler(function(r){" +
    "showStatus(r.message,'success');" +
    "document.getElementById('submitBtn').textContent='Done!';" +
    "setTimeout(function(){google.script.host.close();},2500);" +
    "}).withFailureHandler(function(e){" +
    "showStatus('Error: '+e.message,'error');" +
    "document.getElementById('submitBtn').disabled=false;" +
    "document.getElementById('submitBtn').textContent='Post to Classroom';" +
    "}).submitToClassroom(opts);" +
    "}" +
    "function showStatus(msg,type){" +
    "var s=document.getElementById('status');" +
    "s.textContent=msg;s.className=type;s.style.display='block';" +
    "}" +
    "init();" +
    "</script>" +
    "</body></html>"
  );
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
