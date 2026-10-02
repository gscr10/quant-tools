---
layout: default
title: Array
parent: API Coverage
---

## Array

### Creation & Initialization

| Function               | Status | Description                  |
| ---------------------- | ------ | ---------------------------- |
| `array.copy()`         | ✅     | Create copy of array         |
| `array.from()`         | ✅     | Create array from arguments  |
| `array.new_bool()`     | ✅     | Create boolean array         |
| `array.new_box()`      |        | Create box array             |
| `array.new_color()`    |        | Create color array           |
| `array.new_float()`    | ✅     | Create float array           |
| `array.new_int()`      | ✅     | Create int array             |
| `array.new_label()`    |        | Create label array           |
| `array.new_line()`     |        | Create line array            |
| `array.new_linefill()` |        | Create linefill array        |
| `array.new_string()`   | ✅     | Create string array          |
| `array.new_table()`    |        | Create table array           |
| `array.new<type>()`    | ✅     | Create typed array (generic) |

### Element Access

| Function        | Status | Description        |
| --------------- | ------ | ------------------ |
| `array.first()` | ✅     | Get first element  |
| `array.get()`   | ✅     | Get value at index |
| `array.last()`  | ✅     | Get last element   |
| `array.set()`   | ✅     | Set value at index |

### Modification

| Function          | Status | Description                  |
| ----------------- | ------ | ---------------------------- |
| `array.clear()`   | ✅     | Remove all elements          |
| `array.fill()`    | ✅     | Fill array with value        |
| `array.insert()`  | ✅     | Insert element at index      |
| `array.pop()`     | ✅     | Remove last element          |
| `array.push()`    | ✅     | Append element to end        |
| `array.remove()`  | ✅     | Remove element at index      |
| `array.reverse()` | ✅     | Reverse order                |
| `array.shift()`   | ✅     | Remove first element         |
| `array.unshift()` | ✅     | Prepend element to beginning |

### Size & Shape

| Function         | Status | Description        |
| ---------------- | ------ | ------------------ |
| `array.concat()` | ✅     | Concatenate arrays |
| `array.size()`   | ✅     | Get array size     |
| `array.slice()`  | ✅     | Extract subarray   |

### Search & Query

| Function                          | Status | Description               |
| --------------------------------- | ------ | ------------------------- |
| `array.binary_search()`           | ✅     | Binary search             |
| `array.binary_search_leftmost()`  | ✅     | Binary search (leftmost)  |
| `array.binary_search_rightmost()` | ✅     | Binary search (rightmost) |
| `array.includes()`                | ✅     | Check if value exists     |
| `array.indexof()`                 | ✅     | Find first index of value |
| `array.lastindexof()`             | ✅     | Find last index of value  |

### Statistical

| Function             | Status | Description         |
| -------------------- | ------ | ------------------- |
| `array.avg()`        | ✅     | Average of elements |
| `array.covariance()` | ✅     | Covariance          |
| `array.max()`        | ✅     | Maximum value       |
| `array.median()`     | ✅     | Median value        |
| `array.min()`        | ✅     | Minimum value       |
| `array.mode()`       | ✅     | Mode value          |
| `array.range()`      | ✅     | Range of values     |
| `array.stdev()`      | ✅     | Standard deviation  |
| `array.sum()`        | ✅     | Sum of elements     |
| `array.variance()`   | ✅     | Variance            |

### Percentiles

| Function                                  | Status | Description               |
| ----------------------------------------- | ------ | ------------------------- |
| `array.percentile_linear_interpolation()` | ✅     | Percentile (Linear)       |
| `array.percentile_nearest_rank()`         | ✅     | Percentile (Nearest Rank) |
| `array.percentrank()`                     | ✅     | Percentile rank           |

### Transformation

| Function               | Status | Description          |
| ---------------------- | ------ | -------------------- |
| `array.abs()`          | ✅     | Absolute values      |
| `array.join()`         | ✅     | Join to string       |
| `array.sort()`         | ✅     | Sort array           |
| `array.sort_indices()` | ✅     | Get sorted indices   |
| `array.standardize()`  | ✅     | Standardize elements |

### Logical

| Function        | Status | Description                  |
| --------------- | ------ | ---------------------------- |
| `array.every()` | ✅     | Check if all elements match  |
| `array.some()`  | ✅     | Check if any element matches |
