export const technicalSpeechCases = [
  { language: 'ru', text: 'Что такое SQL JOIN и как отличаются INNER JOIN и LEFT JOIN?', expected: [/SQL\s+JOIN/i, /INNER\s+JOIN/i, /LEFT\s+JOIN/i] },
  { language: 'ru', text: 'Можно ли Kafka отнести к транзакционным системам?', expected: [/kafka/i, /транзакц/i] },
  { language: 'ru', text: 'В Kafka консюмер читает сообщения сразу или ждёт, пока проходит коммит?', expected: [/kafka/i, /консюмер|consumer/i, /коммит|commit/i] },
  { language: 'ru', text: 'А локальное вы устанавливали? Типа MinIO?', expected: [/minio/i] },
  { language: 'ru', text: 'Чем Greenplum отличается от PostgreSQL? Как coordinator и сегменты вместе выполняют запрос?', expected: [/greenplum/i, /postgresql/i, /coordinator|координатор/i, /segment|сегмент/i] },
  { language: 'en', text: 'Did you write the Argo CD pipeline, or was it automated?', expected: [/argo/i, /pipeline/i] },
  { language: 'en', text: 'Have you worked with gRPC, and how would you debug a failed call?', expected: [/grpc/i, /debug|failed/i] },
  { language: 'ru', text: 'У вас был опыт переноса проекта на GCP, например сервиса на Cloud Run?', expected: [/gcp/i, /cloud run/i] },
  { language: 'ru', text: 'Расскажите, пожалуйста, был ли у вас опыт использования gRPC между микросервисами? Как вы диагностировали проблемы с соединением, таймаутами и ошибками вызова?', expected: [/grpc/i, /микросервис/i, /таймаут/i] },
  { language: 'ru', text: 'Как ты управлял секретами в Ансибле через Vault?', expected: [/ansible/i, /vault|ваулт/i, /секрет/i] },
]

// Known weak case is measured separately, not reported as a passing release regression.
export const extendedSpeechCases = [
  { language: 'ru', text: 'Как бы ты диагностировал периодические ошибки пятьсот два в Kubernetes за Nginx Ingress?', expected: [/502|пятьсот\s+два/iu, /kubernetes/i, /nginx\s+ingress/i] },
]
