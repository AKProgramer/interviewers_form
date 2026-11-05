// Shared helpers. Files starting with "_" in /api are not exposed as routes on Vercel.

const CONFIG = {
  mainBoardId: process.env.MAIN_BOARD_ID || '5101747214',
  columns: {
    preferredLocation: { id: 'text_mm8rck7c', title: 'Preferred Location' },
    interviewerNotes: { id: 'long_text_mm83m27z', title: "Interviewer's Notes" },
    meetingSummary: { id: 'file_mm7fxnnf', title: 'סיכום פגישה' },
    status: {
      id: 'color_mm8rrwba',
      title: 'Status',
      options: ['Reviewed – no update needed', 'Updated by interviewer'],
    },
    recommendation: {
      id: 'color_mm8r7s7g',
      title: 'Recommendation Status',
      options: ['See Notes', 'Recommended'],
    },
    garin: {
      id: 'color_mm84zrka',
      title: "Gar'in",
      options: ['מצפה רמון', 'נתיבות', 'צפת', 'מטולה', 'קריית שמונה', 'בית שאן', 'ערד', 'חצור'],
    },
    tasks: { id: 'board_relation_mm7y2gqg', title: 'קישור לטבלת משימות' },
  },
  // Task List board columns (Interviewer Name and Interview Date & Time mirrors are intentionally excluded)
  taskColumns: {
    personInCharge: 'multiple_person_mm7yg5bc',
    linkedVolunteer: 'board_relation_mm7yfya0',
    status: 'color_mm7yhj00',
    description: 'long_text_mm7y3ee6',
    date: 'date_mm7y11fn',
    comments: 'long_text_mm7yxztr',
    files: 'file_mm7y9s3g',
  },
  taskStatusColors: {
    'Working on it': '#fdab3d',
    Done: '#00c875',
    Stuck: '#df2f4a',
    canceled: '#9d50dd',
  },
};

async function mondayQuery(query, variables = {}) {
  const token = process.env.MONDAY_API_TOKEN;
  if (!token) throw new Error('MONDAY_API_TOKEN is not set');

  const res = await fetch('https://api.monday.com/v2', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: token,
      'API-Version': '2025-04',
    },
    body: JSON.stringify({ query, variables }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.errors || body.error_message) {
    const msg =
      (body.errors && body.errors.map((e) => e.message).join('; ')) ||
      body.error_message ||
      `monday API returned HTTP ${res.status}`;
    throw new Error(msg);
  }
  return body.data;
}

const MAIN_ITEM_QUERY = `
query ($id: [ID!]) {
  items(ids: $id) {
    id
    name
    board { id }
    column_values(ids: ["text_mm8rck7c","long_text_mm83m27z","color_mm8rrwba","color_mm8r7s7g","color_mm84zrka","board_relation_mm7y2gqg"]) {
      id
      type
      text
      ... on StatusValue { label }
      ... on BoardRelationValue { linked_item_ids }
    }
    assets(column_ids: ["file_mm7fxnnf"]) { id name file_extension file_size public_url }
  }
}`;

const TASKS_QUERY = `
query ($ids: [ID!]) {
  items(ids: $ids, limit: 100) {
    id
    name
    board { id }
    column_values(ids: ["multiple_person_mm7yg5bc","board_relation_mm7yfya0","color_mm7yhj00","long_text_mm7y3ee6","date_mm7y11fn","long_text_mm7yxztr"]) {
      id
      type
      text
      ... on StatusValue { label }
      ... on BoardRelationValue { display_value }
      ... on DateValue { date time }
    }
    assets(column_ids: ["file_mm7y9s3g"]) { id name file_extension file_size public_url }
  }
}`;

function cv(item, id) {
  return (item.column_values || []).find((c) => c.id === id) || {};
}

// Loads the main item and returns a clean shape. Returns null if not found / wrong board.
async function loadMainItem(itemId) {
  const data = await mondayQuery(MAIN_ITEM_QUERY, { id: [String(itemId)] });
  const item = data.items && data.items[0];
  if (!item || String(item.board.id) !== String(CONFIG.mainBoardId)) return null;

  const c = CONFIG.columns;
  return {
    id: item.id,
    name: item.name,
    boardId: item.board.id,
    fields: {
      preferredLocation: cv(item, c.preferredLocation.id).text || '',
      interviewerNotes: cv(item, c.interviewerNotes.id).text || '',
      status: cv(item, c.status.id).label || '',
      recommendation: cv(item, c.recommendation.id).label || '',
      garin: cv(item, c.garin.id).label || '',
      meetingSummaryFiles: (item.assets || []).map((a) => ({
        assetId: a.id,
        name: a.name,
        extension: a.file_extension,
        size: a.file_size,
        url: a.public_url,
      })),
    },
    linkedTaskIds: cv(item, c.tasks.id).linked_item_ids || [],
  };
}

async function loadTasks(ids) {
  const tc = CONFIG.taskColumns;
  const tasks = [];
  for (let i = 0; i < ids.length; i += 100) {
    const data = await mondayQuery(TASKS_QUERY, { ids: ids.slice(i, i + 100) });
    for (const t of data.items || []) {
      const status = cv(t, tc.status).label || '';
      const date = cv(t, tc.date);
      tasks.push({
        id: t.id,
        name: t.name,
        boardId: t.board && t.board.id,
        personInCharge: cv(t, tc.personInCharge).text || '',
        linkedVolunteer: cv(t, tc.linkedVolunteer).display_value || '',
        status,
        statusColor: CONFIG.taskStatusColors[status] || null,
        description: cv(t, tc.description).text || '',
        date: date.text || '',
        comments: cv(t, tc.comments).text || '',
        files: (t.assets || []).map((a) => ({
          assetId: a.id,
          name: a.name,
          extension: a.file_extension,
          size: a.file_size,
          url: a.public_url,
        })),
      });
    }
  }
  // keep the order the tasks are linked in
  const order = new Map(ids.map((id, i) => [String(id), i]));
  tasks.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  return tasks;
}

// Returns the asset only if it belongs to this item's meeting summary or one of its linked tasks,
// so /api/file can't be used to read arbitrary files from the account.
async function findItemAsset(itemId, assetId) {
  const item = await loadMainItem(itemId);
  if (!item) return null;
  const same = (f) => String(f.assetId) === String(assetId);

  const own = item.fields.meetingSummaryFiles.find(same);
  if (own) return own;

  const tasks = await loadTasks(item.linkedTaskIds);
  for (const t of tasks) {
    const f = t.files.find(same);
    if (f) return f;
  }
  return null;
}

module.exports = { CONFIG, mondayQuery, loadMainItem, loadTasks, findItemAsset };
