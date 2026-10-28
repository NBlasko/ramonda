/** The marks `@ramonda/form` puts on the number and the day its fields show — as its types declare them. */
export type FormNumber = number & { readonly "@ramonda/form:number": true };
export type FormDay = string & { readonly "@ramonda/form:day": true };
