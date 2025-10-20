# Filter Steps Documentation

Filter steps provide powerful data manipulation capabilities in workflows using Liquid templating. They allow you to transform, filter, and process data within your workflow execution.

## Overview

Filter steps are designed to work with data from the workflow context and apply various transformations using Liquid filters. Each filter step has a specific purpose and accepts relevant parameters.

## Available Filter Steps

### 1. `filter.where_exp` - Filter by Expression

Filters array items based on a boolean expression.

```yaml
- name: filter_high_values
  type: filter.where_exp
  with:
    path: "{{ data.values }}"
    exp: "value > 50"
```

**Parameters:**
- `path` (required): Path to the array to filter
- `exp` (required): Boolean expression to evaluate for each item

**Example:**
```yaml
# Input: [10, 60, 30, 80, 40]
# Output: [60, 80]
```

### 2. `filter.concat` - Concatenate Arrays

Combines two arrays into one.

```yaml
- name: combine_arrays
  type: filter.concat
  with:
    path: "{{ data.array1 }}"
    other: "{{ data.array2 }}"
```

**Parameters:**
- `path` (required): First array
- `other` (required): Second array to concatenate

**Example:**
```yaml
# Input: array1=[1,2,3], array2=[4,5,6]
# Output: [1,2,3,4,5,6]
```

### 3. `filter.format` - Format String

Formats a value using a template string.

```yaml
- name: format_message
  type: filter.format
  with:
    path: "{{ data.user.name }}"
    template: "Hello {{ value }}!"
```

**Parameters:**
- `path` (required): Value to format
- `template` (required): Template string with `{{ value }}` placeholder

**Example:**
```yaml
# Input: "John"
# Output: "Hello John!"
```

### 4. `filter.limit` - Limit Array Size

Limits the number of items in an array.

```yaml
- name: get_first_three
  type: filter.limit
  with:
    path: "{{ data.items }}"
    limit: 3
```

**Parameters:**
- `path` (required): Array to limit
- `limit` (required): Maximum number of items

**Example:**
```yaml
# Input: [1,2,3,4,5]
# Output: [1,2,3]
```

### 5. `filter.sort` - Sort Array

Sorts array items by a property.

```yaml
- name: sort_by_name
  type: filter.sort
  with:
    path: "{{ data.items }}"
    property: "name"
    order: "asc"
```

**Parameters:**
- `path` (required): Array to sort
- `property` (required): Property to sort by
- `order` (optional): Sort order ("asc" or "desc", default: "asc")

**Example:**
```yaml
# Input: [{name:"Charlie"},{name:"Alice"},{name:"Bob"}]
# Output: [{name:"Alice"},{name:"Bob"},{name:"Charlie"}]
```

### 6. `filter.map` - Extract Property

Extracts a specific property from each array item.

```yaml
- name: get_names
  type: filter.map
  with:
    path: "{{ data.items }}"
    property: "name"
```

**Parameters:**
- `path` (required): Array to map
- `property` (required): Property to extract

**Example:**
```yaml
# Input: [{name:"Alice",age:25},{name:"Bob",age:30}]
# Output: ["Alice","Bob"]
```

### 7. `filter.group_by` - Group by Property

Groups array items by a specific property.

```yaml
- name: group_by_category
  type: filter.group_by
  with:
    path: "{{ data.items }}"
    property: "category"
```

**Parameters:**
- `path` (required): Array to group
- `property` (required): Property to group by

**Example:**
```yaml
# Input: [{name:"Apple",category:"fruit"},{name:"Carrot",category:"vegetable"}]
# Output: {"fruit":[{name:"Apple",category:"fruit"}],"vegetable":[{name:"Carrot",category:"vegetable"}]}
```

### 8. `filter.first` - Get First Item

Gets the first item from an array.

```yaml
- name: get_first_item
  type: filter.first
  with:
    path: "{{ data.items }}"
```

**Parameters:**
- `path` (required): Array to get first item from

**Example:**
```yaml
# Input: [1,2,3,4,5]
# Output: 1
```

### 9. `filter.last` - Get Last Item

Gets the last item from an array.

```yaml
- name: get_last_item
  type: filter.last
  with:
    path: "{{ data.items }}"
```

**Parameters:**
- `path` (required): Array to get last item from

**Example:**
```yaml
# Input: [1,2,3,4,5]
# Output: 5
```

### 10. `filter.size` - Get Array Size

Gets the number of items in an array.

```yaml
- name: count_items
  type: filter.size
  with:
    path: "{{ data.items }}"
```

**Parameters:**
- `path` (required): Array to count

**Example:**
```yaml
# Input: [1,2,3,4,5]
# Output: 5
```

### 11. `filter.unique` - Remove Duplicates

Removes duplicate items from an array.

```yaml
- name: remove_duplicates
  type: filter.unique
  with:
    path: "{{ data.items }}"
    property: "id"  # Optional: property to check uniqueness by
```

**Parameters:**
- `path` (required): Array to deduplicate
- `property` (optional): Property to check uniqueness by

**Example:**
```yaml
# Input: [1,2,2,3,3,3,4]
# Output: [1,2,3,4]
```

### 12. `filter.reverse` - Reverse Array

Reverses the order of items in an array.

```yaml
- name: reverse_order
  type: filter.reverse
  with:
    path: "{{ data.items }}"
```

**Parameters:**
- `path` (required): Array to reverse

**Example:**
```yaml
# Input: [1,2,3,4,5]
# Output: [5,4,3,2,1]
```

### 13. `filter.join` - Join Array to String

Joins array items into a single string.

```yaml
- name: join_items
  type: filter.join
  with:
    path: "{{ data.items }}"
    separator: ", "  # Optional: separator (default: ",")
```

**Parameters:**
- `path` (required): Array to join
- `separator` (optional): Separator string (default: ",")

**Example:**
```yaml
# Input: ["apple","banana","cherry"]
# Output: "apple, banana, cherry"
```

### 14. `filter.split` - Split String to Array

Splits a string into an array.

```yaml
- name: split_text
  type: filter.split
  with:
    path: "{{ data.text }}"
    separator: ","  # Optional: separator (default: ",")
```

**Parameters:**
- `path` (required): String to split
- `separator` (optional): Separator string (default: ",")

**Example:**
```yaml
# Input: "apple,banana,cherry"
# Output: ["apple","banana","cherry"]
```

## Usage Examples

### Complex Data Processing Workflow

```yaml
name: process_user_data
steps:
  - name: get_users
    type: elasticsearch.search
    with:
      index: "users"
      query:
        match_all: {}

  - name: filter_active_users
    type: filter.where_exp
    with:
      path: "{{ steps.get_users.output.hits.hits }}"
      exp: "value._source.status == 'active'"

  - name: sort_by_created_date
    type: filter.sort
    with:
      path: "{{ steps.filter_active_users.output.result }}"
      property: "_source.created_at"
      order: "desc"

  - name: get_top_10
    type: filter.limit
    with:
      path: "{{ steps.sort_by_created_date.output.result }}"
      limit: 10

  - name: extract_user_info
    type: filter.map
    with:
      path: "{{ steps.get_top_10.output.result }}"
      property: "_source"

  - name: format_user_list
    type: filter.map
    with:
      path: "{{ steps.extract_user_info.output.result }}"
      property: "name"
```

### Data Aggregation Workflow

```yaml
name: aggregate_sales_data
steps:
  - name: get_sales_data
    type: elasticsearch.search
    with:
      index: "sales"
      query:
        range:
          date:
            gte: "2024-01-01"

  - name: group_by_category
    type: filter.group_by
    with:
      path: "{{ steps.get_sales_data.output.hits.hits }}"
      property: "_source.category"

  - name: calculate_totals
    type: filter.map
    with:
      path: "{{ steps.group_by_category.output.result }}"
      property: "value"

  - name: format_summary
    type: filter.format
    with:
      path: "{{ steps.calculate_totals.output.result }}"
      template: "Category: {{ value.category }}, Total: ${{ value.amount }}"
```

## Best Practices

1. **Use meaningful step names** that describe what the filter does
2. **Chain filters logically** to build complex data transformations
3. **Handle empty arrays gracefully** - most filters work with empty arrays
4. **Use Liquid templating** in path parameters to reference dynamic data
5. **Test your expressions** before using them in production workflows
6. **Consider performance** when working with large datasets

## Error Handling

Filter steps will fail gracefully if:
- The specified path doesn't exist in the context
- The data type is incompatible with the filter
- The filter expression is invalid
- Required parameters are missing

Always check the step output and handle errors appropriately in your workflow logic.

