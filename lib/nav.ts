/** يطابق المسار الحالي مع عنصر القائمة (الرئيسية «/» تُطابق بالتساوي فقط). */
export function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/" || pathname === "/index";
  return pathname === href || pathname.startsWith(`${href}/`);
}
