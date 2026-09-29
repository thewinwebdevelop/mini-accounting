function mapCompanyPositionRow(row) {
  const source = row && typeof row === "object" ? row : {};
  return {
    id: source.id || "",
    code: typeof source.code === "string" ? source.code : "",
    label: typeof source.label === "string" ? source.label : "",
    status: source.status === "active" ? "active" : "inactive",
    sortOrder: Number.isFinite(Number(source.sort_order)) ? Number(source.sort_order) : 0,
  };
}

function sortCompanyPositions(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map(mapCompanyPositionRow)
    .filter(position => position.status === "active")
    .sort((left, right) => (
      left.sortOrder - right.sortOrder
      || left.label.localeCompare(right.label)
      || left.id.localeCompare(right.id)
    ));
}

module.exports = {
  mapCompanyPositionRow,
  sortCompanyPositions,
};
