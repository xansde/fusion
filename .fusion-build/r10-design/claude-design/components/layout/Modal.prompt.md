Modal — centered dialog on a dimmed backdrop; header with title + × close, scrollable body, optional footer (muted note left, actions right). Used for the "Adicionar / Trocar magia" compendium picker.

```jsx
<Modal
  title="Adicionar magia — Magus (Arcana)"
  onClose={close}
  footerNote="Dados mecânicos ORC — prosa não incluída (clean-room)"
  footer={<>
    <Button variant="secondary">Cancelar</Button>
    <Button variant="primary">Adicionar ao grimório</Button>
  </>}
>
  <SearchBox /> …filters… …results…
</Modal>
```

Backdrop click and × both call `onClose`. Body scrolls; header and footer stay fixed.
