# CClient Server

Серверные функции для CClient мода, реализующие отправку и получение сообщений через Firebase с использованием Vercel.

## Деплой

Код задеплоен на Vercel. Секретные ключи и URL базы данных задаются через переменные окружения в панели Vercel.

## Функции

- **sendMessage:** Принимает POST запрос с параметрами `from`, `to` и `content` и отправляет сообщение в Firebase.
- **getMessages:** Принимает GET запрос с параметром `user` и возвращает сообщения для указанного пользователя.
