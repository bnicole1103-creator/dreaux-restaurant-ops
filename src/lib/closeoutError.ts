export function readableRpcError(error:unknown,fallback:string):string{
 if(error instanceof Error&&error.message)return error.message
 if(error&&typeof error==='object'){
  const e=error as {message?:unknown;code?:unknown}
  const message=typeof e.message==='string'?e.message.trim():''
  const code=typeof e.code==='string'&&/^[A-Z0-9]{3,12}$/.test(e.code)?e.code:''
  if(message)return message+(code?' ['+code+']':'')
 }
 return fallback
}
export function closeoutErrorMessage(error:unknown):string{
 if(error&&typeof error==='object'&&(error as {code?:unknown}).code==='PGRST202')
  return 'The closeout submission function is missing or its inputs do not match. Ask management to check the closeout SQL. [PGRST202]'
 return readableRpcError(error,'Unable to submit closeout. Your entries are still on this screen. Please try again or contact management.')
}
