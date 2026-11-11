const { CONFIG, loadMainItem, loadTasks, splitRejection } = require('./_monday');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const itemId = String((req.query && (req.query.itemId || req.query.item_id || req.query.id)) || '').trim();

  if (!/^\d+$/.test(itemId)) {
    return res.status(400).json({ error: 'Add ?itemId=<monday item id> to the link.' });
  }

  try {
    const item = await loadMainItem(itemId);
    if (!item) {
      return res.status(404).json({ error: `Item ${itemId} was not found on the Main Volunteers Board.` });
    }
    const tasks = await loadTasks(item.linkedTaskIds);
    const c = CONFIG.columns;
    const rejection = splitRejection(item.fields.interviewerNotes);

    return res.status(200).json({
      item: { id: item.id, name: item.name, boardId: item.boardId },
      fields: { ...item.fields, interviewerNotes: rejection.notes, rejectionReasons: rejection.reasons },
      tasks,
      meta: {
        titles: {
          interviewerNotes: c.interviewerNotes.title,
          meetingSummary: c.meetingSummary.title,
          status: c.status.title,
          recommendation: c.recommendation.title,
          garin: c.garin.title,
        },
        statusOptions: c.status.options,
        recommendationOptions: c.recommendation.options,
        garinOptions: c.garin.options,
        rejectionReasons: CONFIG.rejectionReasons,
        taskStatuses: Object.entries(CONFIG.taskStatusColors).map(([label, color]) => ({ label, color })),
      },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Could not load the item from monday.com: ' + err.message });
  }
};
