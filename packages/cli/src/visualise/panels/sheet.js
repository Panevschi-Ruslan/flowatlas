/* The open tab's title and the sheet the table tabs draw into: Crossings,
   Not joined, Busiest and Changes write their tables here, and every tab
   names itself in the title (P99, which took them over from the Walk tab it
   removed). Set up before the tables, which draw into both. */
export function createSheet() {
  const sheetEl = document.getElementById('tab-sheet');
  const titleEl = document.getElementById('view-title');
  return { sheetEl, titleEl };
}
