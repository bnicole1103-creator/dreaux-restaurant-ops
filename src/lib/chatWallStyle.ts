import {appFonts} from './appearance'
export const chatFonts=appFonts
export const chatInk={espresso:'#3b241b',berry:'#7a2148',plum:'#5d3270',navy:'#1d466b',teal:'#12605b',rust:'#9a3c16',forest:'#356025',black:'#191919'} as const
export const chatPaper={cream:'#fff7ed',rose:'#ffe7ed',lavender:'#eee7ff',sky:'#e5f3ff',mint:'#e4f5e9',gold:'#fff1c9'} as const
export type ChatWallStyle={name_font:keyof typeof chatFonts;name_color:keyof typeof chatInk;message_font:keyof typeof chatFonts;message_color:keyof typeof chatInk;bubble_color:keyof typeof chatPaper}
export const defaultChatStyle:ChatWallStyle={name_font:'system',name_color:'espresso',message_font:'system',message_color:'espresso',bubble_color:'cream'}
export function safeChatStyle(value:unknown):ChatWallStyle{const v=value as Partial<ChatWallStyle>|null;return {name_font:v?.name_font&&Object.prototype.hasOwnProperty.call(chatFonts,v.name_font)?v.name_font:'system',name_color:v?.name_color&&Object.prototype.hasOwnProperty.call(chatInk,v.name_color)?v.name_color:'espresso',message_font:v?.message_font&&Object.prototype.hasOwnProperty.call(chatFonts,v.message_font)?v.message_font:'system',message_color:v?.message_color&&Object.prototype.hasOwnProperty.call(chatInk,v.message_color)?v.message_color:'espresso',bubble_color:v?.bubble_color&&Object.prototype.hasOwnProperty.call(chatPaper,v.bubble_color)?v.bubble_color:'cream'}}
export function nameStyle(style:unknown){const s=safeChatStyle(style);return {fontFamily:chatFonts[s.name_font].css,color:chatInk[s.name_color]}}
export function responseStyle(style:unknown){const s=safeChatStyle(style);return {fontFamily:chatFonts[s.message_font].css,color:chatInk[s.message_color],fontSize:'1.05rem'}}
export function bubbleStyle(style:unknown){return {backgroundColor:chatPaper[safeChatStyle(style).bubble_color],color:chatInk.espresso}}
