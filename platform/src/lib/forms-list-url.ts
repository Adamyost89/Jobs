export type FormsView = "pending" | "submitted";

export type FormsSort =
  | "rep"
  | "rep_desc"
  | "job"
  | "required"
  | "submitted";

export function formsListUrl(opts: {
  view?: FormsView;
  sp?: string;
  sort?: FormsSort;
  eojField?: string;
  eojValue?: string;
}): string {
  const p = new URLSearchParams();
  if (opts.view && opts.view !== "pending") p.set("view", opts.view);
  if (opts.sp) p.set("sp", opts.sp);
  if (opts.sort) p.set("sort", opts.sort);
  if (opts.eojField) p.set("eojField", opts.eojField);
  if (opts.eojValue) p.set("eojValue", opts.eojValue);
  const q = p.toString();
  return q ? `/dashboard/forms?${q}` : "/dashboard/forms";
}
