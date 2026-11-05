const categoryPaths = {
  'Продукты':'M3 8h18l-3 11H6z M8 8l4-5 4 5 M9 11v5 M15 11v5',
  'Жильё':'M2 11l10-8 10 8 M5 10v11h14V10 M10 21v-7h4v7',
  'Здоровье':'M9 3h6v6h6v6h-6v6H9v-6H3V9h6z',
  'Семья':'M9 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M2 21v-2a7 7 0 0 1 14 0v2 M16 5a4 4 0 0 1 0 8 M18 15q4 1 4 6',
  'Проезд':'M5 4h14v14H5z M5 12h14 M8 18v3 M16 18v3 M8 15h1 M15 15h1',
  'Такси':'M3 13l3-6h12l3 6v5H3z M3 13h18 M6 18v3 M18 18v3 M10 4h4',
  'Отдых':'M12 4q-8 0-10 10 5-3 10 0 5-3 10 0Q20 4 12 4z M12 14v5q0 4-4 2',
  'Зарплата':'M3 8h18v12H3z M8 8V5h8v3 M3 12q9 5 18 0 M12 13v3',
  'Подарок':'M3 9h18v4H3z M5 13v8h14v-8 M12 9v12 M12 9Q2 8 6 4q3-2 6 5Q15 2 18 4q4 4-6 5',
};
function categoryIcon(name) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns,'svg');
  svg.setAttribute('viewBox','0 0 24 24');
  svg.setAttribute('class','category-icon');
  svg.setAttribute('aria-hidden','true');
  const path = document.createElementNS(ns,'path');
  path.setAttribute('d',Object.hasOwn(categoryPaths,name) ? categoryPaths[name] : 'M3 3h9l9 9-9 9-9-9z M7 7h1');
  svg.append(path);
  return svg;
}
