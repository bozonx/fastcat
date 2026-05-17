# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - generic:
    - img
  - generic [ref=e7]:
    - button "Toggle Nuxt DevTools" [ref=e8] [cursor=pointer]:
      - img [ref=e9]
    - generic "Page load time" [ref=e12]:
      - generic [ref=e13]: "50"
      - generic [ref=e14]: ms
    - button "Toggle Component Inspector" [ref=e16] [cursor=pointer]:
      - img [ref=e17]
  - region "Notifications (F8)":
    - list
```