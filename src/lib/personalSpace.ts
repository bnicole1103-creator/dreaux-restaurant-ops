import type {CSSProperties} from 'react'
import {stickerBank,type StickerId} from './stickerBank'
import {profileWallStyle,wallPatterns} from './chatWallStyle'
export const personalThemes={
 vanilla:{label:'Vanilla & gold',background:'#faf1e3',card:'#fffaf3',ink:'#3b291d',accent:'#c5a171',border:'#deccb4'},
 rose:{label:'Rose lounge',background:'#fbeaf0',card:'#fff8fa',ink:'#532a3a',accent:'#dca5b6',border:'#e8c2ce'},
 garden:{label:'Garden party',background:'#e9f3e8',card:'#fafff8',ink:'#284634',accent:'#a8c69f',border:'#c1d5bd'},
 sky:{label:'Cloud nine',background:'#eaf0fc',card:'#f9fbff',ink:'#293d60',accent:'#acbfe0',border:'#c4d0e7'},
 mardi:{label:'Mardi Gras',background:'#f0e9f8',card:'#fcf9ff',ink:'#4b2e65',accent:'#d4b465',border:'#d9c7e6'},
 autumn:{label:'Autumn glow',background:'#faeadd',card:'#fff9f3',ink:'#603822',accent:'#d8a57e',border:'#e8c7af'}
} as const
export const personalDecals={none:'No decal',sparkles:'Sparkle trim',botanical:'Botanical trim',ribbon:'Ribbon trim',film:'Film strip'} as const
export type PersonalSticker={id:StickerId;spot:'left'|'center'|'right';size:number;rotation:number}
export type PersonalConfig={theme:keyof typeof personalThemes;pattern:keyof typeof wallPatterns;decal:keyof typeof personalDecals;stickers:PersonalSticker[]}
export const defaultPersonalConfig:PersonalConfig={theme:'vanilla',pattern:'plain',decal:'none',stickers:[]}
const owns=(o:object,k:unknown)=>typeof k==='string'&&Object.prototype.hasOwnProperty.call(o,k)
export function safePersonalConfig(value:unknown):PersonalConfig{const v=value as Partial<PersonalConfig>|null;return {theme:owns(personalThemes,v?.theme)?v!.theme!:'vanilla',pattern:owns(wallPatterns,v?.pattern)?v!.pattern!:'plain',decal:owns(personalDecals,v?.decal)?v!.decal!:'none',stickers:Array.isArray(v?.stickers)?v.stickers.filter(s=>s&&stickerBank.some(b=>b[0]===s.id)&&['left','center','right'].includes(s.spot)&&Number.isFinite(s.size)&&Number.isFinite(s.rotation)).slice(0,6).map(s=>({...s,size:Math.max(24,Math.min(64,s.size)),rotation:Math.max(-25,Math.min(25,s.rotation))})):[]}}
export function personalSpaceStyle(value:unknown):CSSProperties{const c=safePersonalConfig(value),t=personalThemes[c.theme],paper=profileWallStyle({profile_pattern:c.pattern});return {...paper,backgroundColor:t.background,color:t.ink,'--app-background':t.background,'--app-card':t.card,'--app-text':t.ink,'--app-muted':t.ink,'--app-accent':t.accent,'--app-border':t.border} as CSSProperties}
