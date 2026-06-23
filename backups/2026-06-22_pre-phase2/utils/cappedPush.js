export function cappedPush(array, item, cap) {
  array.push(item)
  if (array.length > cap) {
    return array.slice(-cap)
  }
  return array
}

export function cappedUnshift(array, item, cap) {
  array.unshift(item)
  if (array.length > cap) {
    return array.slice(0, cap)
  }
  return array
}
