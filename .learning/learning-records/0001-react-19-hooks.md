# 0001: React 19 Hook'ları

## Tarih

2026-06-25

## Öğrenilenler

- React 19 ile gelen yeni hook'lar: useActionState, useOptimistic, use()
- useActionState: Form state yönetimi için (useState + onSubmit yerine)
- useOptimistic: Optimistic update için (sunucu yanıtı beklemeden anında UI)
- use(): Render sırasında Promise/Context okuma (useEffect + useState yerine)

## Projenin İlgisi

- DayDetailSheet: Form submit'ler useActionState ile sadeleşebilir
- WorkersScreen: Yeni çalışan ekleme useOptimistic ile hızlandırılabilir
- CalendarView: Veri yükleme use() ile basitleşebilir

## Sonraki Adımlar

- Ders 2: TypeScript Generics (fetchQuery<T> gibi typed fonksiyonlar)
- Ders 3: Zustand Middlewares (persist ve devtools)

## Kaynaklar

- React 19 useActionState: https://react.dev/reference/react/useActionState
- React 19 useOptimistic: https://react.dev/reference/react/useOptimistic
- React 19 use(): https://react.dev/reference/react/use
