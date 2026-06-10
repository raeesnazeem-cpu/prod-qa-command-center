# Antigravity IDE Design System Specification: Sage & Obsidian

## 🎨 1. Core Color Palette (Design Tokens)
| Token Name | Hex Value | Application / Usage |
| :--- | :--- | :--- |
| **Primary (Sage)** | `#86B0A3` | Primary Buttons, Active Icons, Brand Accents, Progress Bars. |
| **Primary Hover** | `#000000` | State changes for Primary Buttons and Interactive elements. |
| **Background (App)** | `#F9FAFB` | Main body/canvas background behind cards and layout. |
| **Surface (Card)** | `#FFFFFF` | All container backgrounds, modal surfaces, and white-space fills. |
| **Text (Base)** | `#111827` | Headings (H1-H4), Table Data, Primary Paragraphs. |
| **Text (Muted)** | `#6B7280` | Labels, Table Headers, Helper/Instructional text, Inactive Icons. |
| **Border (Stroke)** | `#E5E7EB` | Hairline separators, Card outlines, Input field borders. |
| **Info Accent** | `#2563EB` | Status banners, "Learn More" actions, System notifications. |

---

## 📐 2. Structural & Layout Constraints
* **Container Max-Width:** `1280px` (Centered via `margin: 0 auto`).
* **Viewport Padding:** `40px` (2.5rem) on all four sides.
* **Grid Gap (Cards):** `24px` (1.5rem) spacing between dashboard cards.
* **Section Spacing:** `48px` vertical gap between distinct functional blocks (e.g., Overview vs. User Lists).
* **Section Headers:** * **Color:** `#111827`
    * **Font-size:** `1.25rem` (20px)
    * **Weight:** Semi-bold (600)
    * **Margin-bottom:** `24px`

---

## 🖼️ 3. Component Specifications

### **Cards & Containers**
* **Background:** `#FFFFFF`
* **Border Radius:** `10px` (Standard Rounded)
* **Border Stroke:** `1px solid #E5E7EB`
* **Depth (Elevation 1):** `box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06);`
* **Internal Padding:** `24px` (1.5rem)

### **Buttons & Interactions**
* **Primary Button:**
    * **BG:** `#86B0A3` (Sage) | **Text:** `#FFFFFF`
    * **Hover:** `#000000` (Black)
    * **Shape:** `6px` radius | **Padding:** `10px 16px`
    * **Transition:** `0.2s ease-in-out`
* **Secondary/Ghost Button:**
    * **BG:** `#FFFFFF` | **Border:** `1px solid #E5E7EB` | **Text:** `#111827`
* **Info Button:**
    * **BG:** `#2563EB` | **Text:** `#FFFFFF`

### **Data Tables & User Lists**
* **Row Height:** `72px`
* **Header Style:** `12px` font, Bold, Uppercase, Text Color `#6B7280`.
* **Avatar:** Circular (`50%` radius), `32px x 32px`, Border `1px solid #E5E7EB`.
* **Cell Alignment:** Vertical center align.

---

## ✒️ 4. Typography & Iconography
* **Font Family:** San-Serif (Inter, Geist, or System UI).
* **Icon Library:** Lucide-react or Heroicons.
* **Icon Weight:** `1.5px` stroke width.
* **Icon Color (Default):** `#6B7280`.
* **Icon Color (Active):** `#86B0A3`.

---

## 🚀 5. Implementation Rules for Antigravity IDE
1.  **Strict Color Adherence:** Never use generic "gray" or "blue"—refer strictly to the Hex codes in Section 1 even for scrollbars, except for errors, warnings badges etc.
2.  **State Management:** Any "Active" or "Selected" menu item must use the Sage or shades of it (`#86B0A3`).
3.  **Clean Lines:** Use `#E5E7EB` for all dividers. Ensure no double-borders occur when cards are adjacent.