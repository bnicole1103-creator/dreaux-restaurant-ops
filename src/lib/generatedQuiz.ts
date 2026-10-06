import type { Question } from '../pages/QuizzesPage'
export type GeneratedQuiz={location:string;date:string;title:string;questions:Question[];warnings:string[]}
export function validGeneratedQuiz(value:unknown):value is GeneratedQuiz{
 const v=value as GeneratedQuiz
 return !!v&&typeof v.location==='string'&&typeof v.date==='string'&&typeof v.title==='string'&&Array.isArray(v.warnings)&&v.warnings.every(x=>typeof x==='string')&&Array.isArray(v.questions)&&v.questions.length>0&&v.questions.length<=20&&v.questions.every(q=>typeof q.prompt==='string'&&q.prompt.trim().length>0&&q.prompt.length<=2000&&typeof q.category==='string'&&q.category.length<=100&&typeof q.explanation==='string'&&q.explanation.length<=2000&&Array.isArray(q.options)&&q.options.length>=2&&q.options.length<=6&&q.options.every(o=>typeof o==='string'&&o.trim().length>0&&o.length<=1000)&&new Set(q.options.map(o=>o.trim().toLowerCase())).size===q.options.length&&Number.isInteger(q.correct)&&q.correct>=0&&q.correct<q.options.length)
}
