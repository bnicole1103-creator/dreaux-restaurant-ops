const block=/\n?\n?—— Sales targets ——\n[\s\S]*?\n—— End sales targets ——/g
export function clearPostTargets(body:string){return body.replace(block,'').trimEnd()}
export function mergePostTargets(body:string,targets:string){
 const next=[clearPostTargets(body),`—— Sales targets ——\n${targets.trim()}\n—— End sales targets ——`].filter(Boolean).join('\n\n')
 if(next.length>12000)throw Error('Adding sales targets would exceed the 12,000-character post limit. Shorten the post first.')
 return next
}
