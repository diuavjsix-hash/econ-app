export function mountAxes(root, store) {
  const horizontal = root.querySelector('#horizontal-axis-name');
  const vertical = root.querySelector('#vertical-axis-name');
  horizontal.addEventListener('input', () => store.update({ axisNames: { x: horizontal.value } }));
  vertical.addEventListener('input', () => store.update({ axisNames: { y: vertical.value } }));
  return store.subscribe(({ axisNames }) => {
    if (horizontal.value !== axisNames.x) horizontal.value = axisNames.x;
    if (vertical.value !== axisNames.y) vertical.value = axisNames.y;
  });
}
