export const accessCatalog={
 "reports": {"label":"Reports","path":"/reports","sections":["builder"]},
 "schedule": {"label":"Schedule","path":"/schedule","sections":["crew","chat","manage"]},
 "home": {
  "label": "Home",
  "path": "/",
  "sections": [
   "notifications",
   "calendar",
   "schedule",
   "posts",
   "quiz",
   "sections",
   "tasks",
   "stock"
  ]
 },
 "floor": {
  "label": "Floor",
  "path": "/floor",
  "sections": [
   "schedule",
   "reservations",
   "sections"
  ]
 },
 "posts": {
  "label": "Posts",
  "path": "/preshift",
  "sections": [
   "feed",
   "builder",
   "receipts",
   "discussion"
  ]
 },
 "calendar": {
  "label": "Calendar",
  "path": "/calendar",
  "sections": [
   "events",
   "reservations",
   "posts",
   "styling"
  ]
 },
 "quizzes": {
  "label": "Quizzes",
  "path": "/quizzes",
  "sections": [
   "published",
   "builder",
   "scores"
  ]
 },
 "training": {
  "label": "Training",
  "path": "/training",
  "sections": [
   "cocktails",
   "food",
   "guides",
   "quizzes"
  ]
 },
 "tasks": {
  "label": "Tasks",
  "path": "/tasks",
  "sections": [
   "mine",
   "assign",
   "presets",
   "team"
  ]
 },
 "inventory": {
  "label": "Inventory",
  "path": "/inventory",
  "sections": [
   "disposal",
   "incoming",
   "history"
  ]
 },
 "team": {
  "label": "Team",
  "path": "/team",
  "sections": [
   "roster"
  ]
 },
 "points": {
  "label": "Points",
  "path": "/rewards",
  "sections": [
   "mine",
   "leaderboard"
  ]
 },
 "summary": {
  "label": "Summary",
  "path": "/closeout-summary",
  "sections": [
   "closeouts",
   "cash",
   "reviews"
  ]
 },
 "closeout": {
  "label": "Closeout",
  "path": "/closeout",
  "sections": [
   "staff",
   "manager"
  ]
 },
 "guests": {
  "label": "Guest Services",
  "path": "/inquiry-inbox",
  "sections": [
   "host",
   "inbox",
   "feedback",
   "forms",
   "studio"
  ]
 },
 "settings": {
  "label": "Settings",
  "path": "/settings",
  "sections": [
   "styling",
   "forms",
   "points",
   "sales",
   "permissions"
  ]
 }
} as const
export type AccessPage=keyof typeof accessCatalog
export function accessPage(path:string):AccessPage {if(path.startsWith("/reservation-inquiries")||path.startsWith("/guest-feedback")||path.startsWith("/inquiry-"))return "guests";if(path.startsWith("/appearance"))return "settings";if(path.startsWith("/closeout-summary")||path==="/cash")return "summary";if(path.startsWith("/closeout/")&&/settings|permissions|awards/.test(path))return "settings";return (Object.keys(accessCatalog) as AccessPage[]).find(k=>accessCatalog[k].path!=="/"&&(path===accessCatalog[k].path||path.startsWith(accessCatalog[k].path+"/")))??"home"}
