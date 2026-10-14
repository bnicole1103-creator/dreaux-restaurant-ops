export function wholeWordingElement(target: Element): HTMLElement | null {
 const nearest=target.closest<HTMLElement>('[data-design-word]')
 if(!nearest)return null
 // Word tokens belong to a complete editable phrase. Never select one token.
 if(/\.w\d+$/.test(nearest.dataset.designWord??''))return nearest.parentElement?.closest<HTMLElement>('[data-design-word]')??nearest
 return nearest
}
export function wordingElements(root: ParentNode): HTMLElement[] {
 return Array.from(root.querySelectorAll<HTMLElement>('[data-design-word]')).filter(e=>!/\.w\d+$/.test(e.dataset.designWord??''))
}
export function editorPreviewActive(search: string, embedded: boolean) {
 return embedded&&new URLSearchParams(search).has('wording-preview')
}
export const blockedPreviewEvents=['click','dblclick','pointerdown','pointerup','pointercancel','mousedown','mouseup','touchstart','touchend','submit','keydown','keyup','beforeinput','input','change','dragstart','drop','contextmenu'] as const

export function preventPreviewDefault(type:string){return !['pointerdown','pointerup','pointercancel','mousedown','mouseup','touchstart','touchend'].includes(type)}
