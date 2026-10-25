import {pricedMenuChoices,menuSalesExamples,type SalesMenuItem,type MenuService} from './menuCatalog'
export function automaticMenuSuggestions(items:SalesMenuItem[],service:MenuService,remaining:number){
 const choices=pricedMenuChoices(items,service)
 const desserts=choices.filter(c=>/dessert/i.test(c.category)&&!/cocktail/i.test(c.category))
 const sweet=desserts.find(c=>/cheesecake/i.test(c.name))??desserts[0]??choices[0]??null
 const meal=choices.find(c=>/entr|brunch/i.test(c.category)&&/pasta/i.test(c.name))??choices.find(c=>/entr|brunch/i.test(c.category))??choices.find(c=>c.key!==sweet?.key)??null
 const first=remaining>100?meal??sweet:sweet??meal
 const second=first?.key===sweet?.key?meal:sweet
 return {first,second,examples:menuSalesExamples(remaining,first,second)}
}
