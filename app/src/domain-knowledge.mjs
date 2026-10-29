const TOPICS = [
  {
    id: 'zabbix-basics',
    match: /(?:\bZabbix\b|забб?икс)/iu,
    guidance: [
      'Zabbix следит за состоянием серверов и приложений. Можно смотреть загрузку процессора, свободное место и доступность сайта. Если показатель выходит за заданный порог, отправляется уведомление. В простом объяснении покажи один случай, например место на диске заканчивается и администратор получает сообщение. Не перечисляй SNMP, агентов и другие системы мониторинга, если способы сбора данных не спрашивали.',
    ],
    english: [
      'Zabbix monitors servers and apps. It can check CPU use, free disk space or whether a website responds. It sends an alert when a set limit is reached. Use one simple example, such as a disk filling up and an admin getting a message. Do not list SNMP, agents or other monitoring tools unless asked how data is collected.',
    ],
  },
  {
    id: 'api-basics',
    match: /(?:\bAPI\b|\bapplication programming interface\b)/iu,
    guidance: [
      'API задаёт способы, которыми одна программа обращается к другой. Например, сайт отправляет запрос на создание заявки, а сервер возвращает номер заявки или ошибку. Разработчик знает, какой запрос отправить и какие данные получит. API не обязательно работает через HTTP или сеть. Для общего объяснения не добавляй обзор протоколов, метеослужбы и посторонние технологии.',
    ],
    english: [
      'An API defines how one program can use another. For example, a website asks a server to create a ticket. The server returns the ticket number or an error. The developer knows what to send and what reply to expect. Not every API uses HTTP or a network. Keep a basic explanation focused, without a protocol overview or unrelated tools.',
    ],
  },
  {
    id: 'proxy',
    match: /(?:\bproxy\b|прокси)/iu,
    guidance: [
      'Прокси принимает запрос, отправляет его другому серверу и возвращает ответ. Forward proxy работает со стороны клиента, reverse proxy принимает запросы перед приложением. Прокси не обязательно скрывает IP и не всегда использует кэш.',
      'Пример простой подачи, не обязательный текст ответа. Прокси это сервер, через который идёт запрос. Вместо прямого обращения к сайту запрос сначала попадает на прокси, а тот передаёт его дальше и возвращает ответ. Например, в компании через него можно закрыть доступ к отдельным сайтам. Не добавляй список преимуществ.',
    ],
    english: [
      'A proxy takes a request, sends it to another server, and returns the reply. A forward proxy is on the client side; a reverse proxy sits in front of an app. Not every proxy hides an IP or uses a cache.',
      'Plain speech example, not a required script. A proxy is a server that sends requests for you. Your request goes to the proxy first, then to the website. The reply comes back through the proxy. A company can use it to block some websites. Do not add a list of benefits.',
    ],
  },
  {
    id: 'nat',
    match: /(?:\bNAT\b|трансляц\p{L}*\s+(?:сетев\p{L}*\s+)?адрес\p{L}*)/iu,
    guidance: [
      'NAT меняет IP-адрес при прохождении пакета через роутер. Для вопроса "зачем" обязательно объясни главный бытовой пример. Телефон и ноутбук имеют разные адреса внутри сети, но выходят в интернет через один внешний IP роутера. Роутер направляет ответы нужному устройству. Этот вариант обычно также меняет порты (PAT). NAT не шифрует соединение и сам по себе не заменяет firewall.',
      'Объясняй на телефоне и ноутбуке, подключённых к одному роутеру. Не своди ответ только к смене адреса одного телефона, скажи про общий внешний IP для нескольких устройств. Не называй NAT защитой от внешних угроз и не добавляй абстрактную экономию ресурсов. При вопросе про детали сохрани различие между переводом адресов и портов.',
    ],
    english: [
      'NAT changes an IP address as a packet passes through a router. At home, a phone and laptop can share the router\'s public IP. The router sends replies to the right device. This form usually also changes ports (PAT). NAT does not encrypt traffic and is not a replacement for a firewall.',
      'Use a phone and laptop on one home router as the example. Do not describe NAT as protection from outside threats or add vague benefits about saving resources. Keep the difference between address and port translation when asked for detail.',
    ],
  },
  {
    id: 'firewall',
    match: /(?:\bfirewall\b|фа[йе]рвол\p{L}*|межсетев\p{L}*\s+экран\p{L}*)/iu,
    guidance: [
      'Firewall разрешает или блокирует соединения по правилам. В простом примере можно разрешить доступ к сайту на порту 443, а SSH на 22 только с IP администратора. Разрешённое соединение не обязательно безопасно. Некоторые firewall также проверяют содержимое запросов. Нельзя утверждать, что firewall никогда не проверяет содержимое или работает только с адресом и портом.',
      'Говори "пропускает или блокирует соединения" и покажи одно правило вместо "контролирует трафик", "легитимный трафик" и обзора уровней OSI. Не добавляй сравнение с антивирусом, если его не спрашивали. Уровни, виды firewall и детали фильтрации объясняй, только если об этом спросили.',
    ],
    english: [
      'A firewall lets connections through or blocks them using rules. For example, allow website access on port 443 and SSH on port 22 only from the admin\'s IP. An allowed connection is not proof that it is safe. Some firewalls also check request content. Never say firewalls cannot or do not check content, or only check IP addresses and ports.',
      'Say "lets a connection through or blocks it" and give one rule. Do not add an antivirus comparison, an OSI overview or terms like legitimate traffic unless the question asks for that detail.',
    ],
  },
  {
    id: 'sql-aggregate-null',
    match: /(?:\b(?:COUNT|SUM)\s*\(|\b(?:SQL|PostgreSQL|MySQL|SQLite)\b.{0,80}\b(?:COUNT|SUM)\b|\b(?:COUNT|SUM)\b.{0,80}\b(?:SQL|PostgreSQL|MySQL|SQLite)\b)/i,
    guidance: [
      'В SQL COUNT(*) считает строки, а COUNT(column) только значения не NULL. Говори именно NULL, не просто "пустое значение": пустая строка и 0 считаются COUNT(column). Сам COUNT не фильтрует магазины или другие строки результата. После LEFT JOIN без совпадения правые колонки NULL, не 0: COUNT(right.id) даст 0, COUNT(*) даст 1. Если же реальный right.id равен 0, COUNT(right.id) даст 1. В запросе без WHERE/HAVING несовпавшие магазины остаются с нулём, а не исключаются. Для подсчёта настоящих правых строк выбирай их ключ, который не бывает NULL; не выдумывай это ограничение для неизвестной колонки.',
      'Фильтр правой таблицы в ON оставляет несовпавшие левые строки; тот же фильтр в WHERE может их убрать. На вопрос о подсчёте объясни именно выбор COUNT и его результат, а не только сам JOIN.',
      'SUM складывает значения, пропуская NULL. Если входных строк нет или в них только NULL, результат NULL, не 0. Настоящие нули или значения 2 и -2 дают сумму 0. Без данных таблицы нельзя выбрать конкретный результат; отсутствующие на снимке строки не означают пустую таблицу.',
    ],
    english: [
      'SQL COUNT(*) counts rows; COUNT(column) counts only non-NULL values. Say NULL, not just "empty": an empty string and 0 are counted by COUNT(column). COUNT itself does not filter shops or other result rows. After a LEFT JOIN with no match, right-side columns are NULL, not 0: COUNT(right.id) gives 0, COUNT(*) gives 1. A real right.id value of 0 makes COUNT(right.id) give 1. Without WHERE/HAVING, unmatched shops stay in the result with zero; they are not removed. To count real right-side rows, use their non-NULL key; do not invent that constraint for an unknown column.',
      'A right-table filter in ON keeps unmatched left rows; the same filter in WHERE can remove them. For a counting question, explain the COUNT choice and its effect, not only the JOIN.',
      'SUM skips NULL and returns NULL with no non-NULL inputs, not 0. Real values can sum to 0, such as 2 and -2. Missing table rows are not proof of an empty table; do not guess an exact sum without the data.',
    ],
  },
  {
    id: 'postmortem',
    match: /(post[- ]?mortem|пост.?мортем|разбор инцидент|разбор аварии)/i,
    guidance: [
      'Хороший postmortem разбирает сбой без поиска виноватого: влияние на пользователей, время начала и восстановления, как инцидент заметили, что делали и какие причины подтверждены. Отделяй факты от гипотез и первопричину от сопутствующих факторов.',
      'Для подготовки сведи логи, метрики, изменения и сообщения в одну временную шкалу с часовым поясом и проверь её с участниками. В конце нужны конкретные действия с владельцем, сроком и способом проверить результат, а не просто «быть внимательнее».',
    ],
    english: [
      'A good postmortem explains user impact, the timeline, detection, response, and confirmed causes without blaming a person. Separate facts from guesses, and the main cause from other factors.',
      'Use logs, metrics, changes, and team notes to build one timeline. End with clear actions, an owner, a due date, and a way to check the result. Avoid vague actions like “be more careful.”',
    ],
  },
  {
    id: 'payment-timeout',
    match: /(payment|плат[её]ж|провайдер|provider|timeout|тайм.?аут|invoice|shop.?id)/i,
    requireAny: [/(provider|провайдер|timeout|тайм.?аут|invoice|shop.?id)/i],
    guidance: [
      'HTTP 500 означает, что сервер не смог обработать запрос, но код, выданный нашим API, сам по себе не доказывает, какой внутренний сервис или внешний провайдер виноват. 4xx обычно связан с запросом клиента, 2xx с успехом; реальный смысл проверяют по конкретному коду и контракту API.',
      'Для массовости сравнить число ошибок с общим числом запросов за тот же интервал, показать долю, начало проблемы и срезы по провайдеру, методу, мерчанту, shop_id и корреляционному ID. Один лог не показывает масштаб.',
      'Для эскалации провайдеру дать время с часовым поясом, тип операции, ID запроса/транзакции, безопасно замаскированные идентификаторы, статус и длительность по этапам, несколько примеров и масштаб. Публичный исходящий IP полезен, если провайдер ищет сетевой след или применяет allowlist; не объявлять его обязательным всегда. Не отправлять секреты, токены и полные платёжные данные.',
      'Если провайдер отвечает вовремя, сравнить его время обработки с нашим полным временем: сетевой путь, таймаут клиента, очередь, retry, соединения и медленные запросы БД. Лишь по одному сообщению timeout нельзя уверенно назвать виновника.',
    ],
  },
  {
    id: 'p95-latency',
    match: /(p95|95.?й?\s*перцентил|95th percentile|percentile|перцентил)/i,
    guidance: [
      'p95 = 8 секунд значит, что 95% измеренных запросов завершились не дольше чем за 8 секунд, а около 5% были медленнее. Это не среднее и не означает, что ровно 95 запросов были быстрыми.',
      'Для смысла метрики назови период измерения, сервис/метод и число запросов. При сравнении с провайдером отдельно измеряй его время и полное время нашего API.',
    ],
  },
  {
    id: 'service-health-signals',
    match: /(before.{0,25}(?:fail|down)|early warning|degrad\w*|сигнал\w*|деградац\w*|до падения|прежде чем.{0,20}(?:упасть|сломаться)|monitor\w*|мониторинг)/i,
    requireAny: [/(signal|сигнал|metric|метрик|monitor|монитор|degrad|деградац)/i],
    guidance: [
      'Для онлайн-сервиса начни с четырёх сигналов: трафик, задержка, ошибки и насыщение ресурсов. Смотри p95/p99, а не только среднее: редкие медленные запросы могут теряться в среднем значении. Сравнивай с обычным уровнем и SLO сервиса.',
      'Потом проверь запас: очередь и время ожидания, пул соединений, CPU, память, диск и ошибки зависимостей. Растущая задержка и очередь часто предупреждают о перегрузе раньше полного отказа.',
      'Алерти по симптомам, которые влияют на пользователя. Графики и логи помогают найти причину; один высокий CPU без влияния на сервис не всегда повод будить дежурного. Сверь ухудшение с релизами, внешними зависимостями и бизнес-метриками.',
    ],
    english: [
      'For an online service, start with four signals: traffic, latency, errors, and saturation. Check p95 or p99, not only the average; a few very slow requests can disappear in an average. Compare them with the normal level and the service SLO.',
      'Then check spare capacity: queue depth and wait time, connection pools, CPU, memory, disk, and dependency errors. Rising latency and queues can warn about overload before a full failure.',
      'Alert on symptoms that affect users. Graphs and logs help find the cause; high CPU alone is not always a reason to wake someone. Compare changes with releases, external services, and business metrics.',
    ],
  },
  {
    id: 'production-readiness',
    match: /(production.?readiness|readiness|before.{0,35}(?:handover|handing|release|production)|эксплуатац|передач\w*.{0,25}(?:сервис|эксплуатац|прод)|запуск\w*.{0,20}(?:production|продакшн)|go.?live)/i,
    requireAny: [/(сервис|service|микросервис|microservice|релиз|release|handover|передач|production|продакшн)/i],
    guidance: [
      'Перед передачей сервиса в эксплуатацию проверь, что назначен владелец и понятен SLO. Нужны метрики запросов и ошибок, структурированные логи с request/correlation ID, дашборд и алерт с конкретным действием.',
      'Проверь health/readiness checks, внешние зависимости и поведение при их отказе: конечные таймауты, ограниченные повторы с backoff, лимиты очередей и пулов соединений, безопасная деградация. Повторы не должны создавать дубли для неидемпотентной операции.',
      'До выпуска проверь лимиты ресурсов и нагрузку, короткий runbook, ответственных и способ отката. Не считай наличие Grafana или health endpoint само по себе готовностью сервиса.',
    ],
    english: [
      'Before handover, name an owner and agree on an SLO. The service needs request and error metrics, useful logs with a request ID, a dashboard, and an alert with a clear action.',
      'Check health and readiness checks, dependencies, and failure behavior: timeouts, limited retries with backoff, queue and connection-pool limits, and safe fallback. Retries must not create duplicate work for a non-idempotent action.',
      'Before release, check resource limits and load, a short runbook, owners, and a rollback plan. A dashboard or health endpoint alone does not make a service ready.',
    ],
  },
  {
    id: 'terraform-rollback',
    match: /(terraform|терраформ|тераформ|треформ)/i,
    requireAny: [/(откат|открат|rollback|roll back|неудачн|failed deployment)/i],
    guidance: [
      'После неудачного Terraform apply сначала выяснить, какие ресурсы реально изменились, и проверить состояние сервиса и state. Не считать откат state откатом инфраструктуры.',
      'Взять предыдущую рабочую версию конфигурации из Git, сделать terraform plan с ней и внимательно проверить diff, особенно удаление ресурсов и данные. State обычно хранится отдельно от Git; не утверждать, что предыдущий state можно взять из Git. Согласовать план с командой и только затем apply.',
      'Если apply завершился частично, разбирать изменённые ресурсы отдельно. Не применять вслепую старый plan, не делать state rm и не использовать force-unlock без проверки владельца блокировки.',
    ],
    english: [
      'After a failed Terraform apply, inspect what changed in the real infrastructure and check the service and state. Reverting state alone does not revert infrastructure.',
      'Use the previous known-good configuration from Git to make a fresh plan. Terraform state is usually stored separately, not in Git. Review the diff, especially destroys and data changes, coordinate with the team, then apply the reviewed plan.',
      'A partial apply may need resource-by-resource recovery. Do not blindly reuse an old plan or force-unlock a lock you have not checked.',
    ],
  },
  {
    id: 'ci-container',
    match: /(docker|докер|container|контейнер)/i,
    requireAny: [/(pipeline|пайплайн|\bci\b|\bcd\b|runner|дженкинс|jenkins|gitlab)/i],
    guidance: [
      'Если контейнер работает локально, но падает в CI/CD, сперва смотреть точный упавший этап и первую ошибку в логах runner: сборка образа, получение зависимостей, запуск или деплой.',
      'Затем сравнить версию образа, переменные окружения и секреты, права, сеть и доступ к registry между локальной средой и runner. Нельзя делать вывод, что локальный контейнер не зависит от внешних сервисов.',
      'Разница образов или настроек - гипотеза, не доказательство. Менять по одному подозрительному отличию и повторять тот же упавший CI job. Другая ошибка не исключает проблему в образе; повтор прежней ошибки не доказывает проблему в CI. Проверить исчезновение исходной ошибки и успешное завершение job, прежде чем говорить о результате.',
    ],
    english: [
      'I check the failed CI/CD step and first error in its logs before choosing what to compare.',
      'I compare the actual image, not just its tag, and settings linked to that error. Local containers may need other services.',
      'I change one suspected difference at a time and rerun the same failed CI job. A different error does not rule out the image. The same error does not prove CI is at fault. I check that the original error is gone and the job passes before claiming a fix.',
    ],
  },
  {
    id: 'nginx-basics',
    match: /\bnginx\b/i,
    requireAny: [/(what is|что такое|расскаж.{0,25}(?:nginx|нинкс)|объясн.{0,20}(?:nginx|нинкс))/i],
    guidance: [
      'Nginx - веб-сервер и reverse proxy. Статические файлы, например картинки, он может отдавать сам, а запросы к приложению передаёт ему. Для примера возьми картинку, не целую страницу: её содержимое может формировать приложение. Не утверждай, что любой запрос с кодом обязательно уходит в приложение или что Nginx сам по себе не нагружает систему.',
    ],
    english: [
      'Nginx is a web server and a reverse proxy. It can serve static files, such as images, and send app requests to an app server. Use an image, not a whole web page, as the example; an app may build the page. Do not say every request for code must go to the app or that Nginx puts no load on the system.',
    ],
  },
  {
    id: 'nginx-502',
    match: /(502|bad gateway)/i,
    requireAny: [/(nginx|ingress|engine ingress|кубер|kubernetes)/i],
    guidance: [
      'При периодических 502 за Nginx ingress первым делом сопоставить время ошибки с логом ingress: connection refused, upstream timeout или premature close укажут разные причины.',
      'Проверить endpoints и readiness backend-подов, рестарты и OOM, затем задержку и нагрузку сервиса. Здоровые поды не исключают пустые endpoints или таймаут между ingress и backend.',
    ],
    english: [
      'For intermittent 502s behind Nginx ingress, match the time of a failed request to ingress logs. Connection refused, upstream timeout, and premature close point to different causes.',
      'Check service endpoints, backend readiness, restarts and OOM, then latency and load. Healthy pods alone do not rule out empty endpoints or a timeout between ingress and backend.',
    ],
  },
  {
    id: 'kubernetes-ingress-service-mesh',
    match: /(service.?mesh|сервис.?меш|ingress|ингресс|gateway api|гейтвей api)/i,
    guidance: [
      'Ingress в Kubernetes задаёт правила для входящего HTTP/HTTPS-трафика к Service. Сам объект ничего не маршрутизирует: нужен отдельно установленный Ingress Controller, который применяет эти правила.',
      'Service mesh - отдельный слой для связи между сервисами: он может добавлять mTLS, правила маршрутизации, повторы запросов и телеметрию. В Kubernetes он не встроен. Некоторые mesh-системы дают свой ingress gateway, но это не делает mesh и Kubernetes Ingress одним и тем же.',
      'Не угадывай, какие именно Nginx, Consul, Istio или Gateway API стоят в конкретной схеме. Назови разницу по роли компонентов и уточни реализацию, если она важна.',
    ],
    english: [
      'In Kubernetes, Ingress defines rules for incoming HTTP/HTTPS traffic to a Service. The object does not route traffic by itself; a separately installed Ingress controller must apply the rules.',
      'A service mesh is a separate layer for traffic between services. It can add mTLS, routing rules, retries, and telemetry. Kubernetes does not include a mesh by default. Some meshes provide their own ingress gateway, but that does not make a mesh and Kubernetes Ingress the same thing.',
      'Do not guess whether a system uses Nginx, Consul, Istio, or Gateway API. Explain each component by its role and ask which implementation is used if it matters.',
    ],
  },
  {
    id: 'linux-load-average',
    match: /(load\s*average|лоад\s*эвер|low\s*average|\bla\b|cpu|процессор|iowait|d-state|uninterruptible|нагрузк[аи])/i,
    requireAny: [/(load\s*average|лоад\s*эвер|low\s*average|\bla\b)/i, /(cpu|процессор)/i],
    guidance: [
      'Load average в Linux - это среднее число задач, которые либо готовы выполняться на CPU, либо ждут в uninterruptible sleep, чаще всего D-state на вводе-выводе. Это не процент загрузки CPU.',
      'Высокий load при CPU около 20% обычно объясняют ожиданием диска/NFS/блочного устройства, лимитами cgroup/CPU quota, большим числом runnable-задач относительно числа ядер или зависшими процессами в D-state. Обычные sleeping-задачи в load average не входят.',
      'Полезные проверки: uptime/top/htop для load и числа ядер, ps -eo state,pid,comm,wchan:32 | grep "^D" для D-state, vmstat 1 для r/b/wa, iostat -xz 1 для await/util, pidstat -dru 1 для процесса. Вывод команды нужно интерпретировать, а не просто перечислять.',
    ],
  },
  {
    id: 'terraform-drift',
    match: /(terraform|терраформ|тераформ|треформ|drift|дрифт)/i,
    requireAll: [/(terraform|терраформ|тераформ|треформ)/i, /(drift|дрифт|ручн|manual)/i],
    guidance: [
      'Terraform drift после ручного изменения production - это расхождение между конфигурацией, state и реальным ресурсом. Нельзя сразу делать apply/import/state rm: сначала нужно понять, какое состояние должно быть целевым.',
      'Безопасный порядок: сохранить plan как артефакт, посмотреть diff и реальный ресурс, понять владельца изменения и риск, взять lock/согласование, проверить зависимости и откат. Потом выбрать одно из двух: если ручное изменение правильное - перенести его в код Terraform и прогнать plan; если неправильное - планом вернуть ресурс к коду.',
      'После выбора целевого состояния в обоих вариантах получить новый сохранённый plan с актуальным кодом. Проверить итоговый diff, особенно удаления и замены, и согласовать изменения. Только после этого применить именно согласованный план через terraform apply <plan-file>. Старый plan после правки кода не подходит. В ответе назови проверку и согласование плана до apply для обоих вариантов, а не только для сохранения ручной правки.',
      'terraform refresh-only может обновить state под реальность, но не исправляет конфигурацию. import нужен для ресурса, которого нет в state, а не как универсальное лечение drift. state rm/manual state edit опасны и требуют отдельного, очень обоснованного кейса.',
    ],
  },
  {
    id: 'greenplum',
    match: /(green\s*plum|greenplum|гринплам|гринплум)/i,
    guidance: [
      'Greenplum это распределённая MPP-база для аналитики на основе PostgreSQL. Клиент подключается к coordinator (раньше master), который планирует запрос и раздаёт работу сегментам. Строки пользовательских таблиц хранятся на сегментах и обрабатываются параллельно. У coordinator есть системный каталог с описанием базы и кластера. Не говори, что он вообще не хранит данные.',
      'Таблицу распределяют по сегментам по ключу или случайно. Для хорошей скорости важно избегать перекоса, когда большая часть строк попадает на один сегмент; одинаковый ключ распределения у связанных таблиц может уменьшить пересылку данных при join. Не называй Greenplum просто обычным PostgreSQL или только репликой.',
    ],
    english: [
      'Greenplum is built on PostgreSQL for work with large tables. It splits tables between servers. MPP means these servers work at the same time. The coordinator takes the query and sends parts to the segments. Segments store table rows and work in parallel. The coordinator keeps a system catalog with details about the database and cluster. Do not say it stores no data at all.',
      'A table key decides which segment gets each row; random placement is another option. If most rows go to one segment, it does more work and the query can be slow. Matching keys in joined tables can mean less data sent between servers. Do not call Greenplum plain PostgreSQL or just a copy of its data.',
    ],
  },
  {
    id: 'postgres-replication',
    match: /(postgres(?:ql)?|постгрес)/i,
    requireAny: [/(replicat|репликац|standby|stand.?by|streaming replication|failover|переключени[ея])/i],
    guidance: [
      'Для физической streaming replication primary пишет WAL, а standby получает и применяет его. На primary задают wal_level=replica, replication-доступ и правила pg_hba.conf; standby создают из base backup и настраивают подключение к primary. Точные шаги зависят от версии PostgreSQL.',
      'Синхронный режим ждёт подтверждение standby и уменьшает риск потери подтверждённых транзакций, но добавляет задержку и может остановить запись при проблеме с репликой. Асинхронный быстрее, но при потере primary можно потерять последние записи.',
      'Репликация сама не делает автоматический failover. Нужны проверенное переключение с защитой от split-brain, мониторинг отставания, резервные копии и проверенное восстановление. Реплика не заменяет backup.',
    ],
    english: [
      'In physical streaming replication, the primary sends WAL records and a standby applies them. Set up replication access on the primary, make a base backup, and configure the standby to connect. Exact settings depend on the PostgreSQL version.',
      'Synchronous mode waits for a standby and can reduce data loss, but it adds latency and may block writes. Asynchronous mode is faster, but a primary failure can lose recent changes.',
      'Replication does not provide failover by itself. You still need a tested promotion process, split-brain protection, lag monitoring, backups, and restore tests. A replica is not a backup.',
    ],
  },
  {
    id: 'postgres-vacuum',
    match: /(postgres(?:ql)?|постгрес|вакуум|\bvacuum\b)/i,
    requireAny: [/(\bvacuum\b|autovacuum|вакуум|freeze|замороз)/i],
    guidance: [
      'UPDATE и DELETE в PostgreSQL оставляют старые версии строк, пока их не уберёт обслуживание. Обычный VACUUM делает место от мёртвых строк доступным для повторного использования, обновляет visibility map и помогает не допустить переполнения transaction ID; autovacuum обычно делает это автоматически.',
      'Обычный VACUUM обычно оставляет файл таблицы прежнего размера, но может обрезать полностью свободные страницы в конце таблицы и вернуть их место ОС. Поэтому не говори, что он никогда не возвращает место ОС. VACUUM FULL переписывает таблицу и требует ACCESS EXCLUSIVE lock, поэтому не подходит для рутинной уборки. Обычная фоновая уборка тоже может нагрузить диск; autovacuum не гарантирует отсутствие задержек или блокировок. VACUUM не отвечает за уровень изоляции транзакций.',
    ],
    english: [
      'PostgreSQL keeps old row versions after UPDATE and DELETE until cleanup. Regular VACUUM makes dead-row space reusable, updates the visibility map, and helps prevent transaction ID wraparound. Autovacuum usually runs this maintenance automatically.',
      'Regular VACUUM usually keeps the same table file size, but it can truncate fully empty pages at the end of the table and return that space to the OS. Do not say it never returns space to the OS. VACUUM FULL rewrites the table and needs an ACCESS EXCLUSIVE lock, so it is not routine cleanup. Background cleanup can also add disk load; autovacuum does not guarantee no delays or locks. VACUUM does not set transaction isolation.',
    ],
  },
  {
    id: 'docker-multistage',
    match: /(dockerfile|docker|докер|multi.?stage|многоэтапн)/i,
    requireAny: [/(multi.?stage|нескольк.{0,20}(?:этап|from)|финальн.{0,20}образ|builder|runtime)/i],
    guidance: [
      'Каждый FROM начинает новый этап сборки. В builder-этапе ставят инструменты и собирают приложение, а в финальном runtime-этапе оставляют только то, что нужно для запуска, и копируют результат через COPY --from=builder. Так компилятор и инструменты сборки не попадают в финальный образ, если их туда отдельно не копировать.',
      'Multi-stage обычно уменьшает финальный образ и убирает лишние build-инструменты, но сам по себе не гарантирует маленький или безопасный образ. Проверь, что в финале остались нужные runtime-библиотеки, сертификаты и конфиги; базовый образ и зависимости всё равно надо обновлять и проверять.',
    ],
    english: [
      'Each FROM starts a new build stage. Build the app in a builder stage, then use a runtime image for the final stage and copy the app with COPY --from=builder. The compiler and build tools stay out of the final image unless you copy them there.',
      'This often makes the final image smaller, but it does not make it small or safe by itself. Keep the runtime libraries, certificates, and config the app needs. The base image and app packages still need updates and checks.',
    ],
  },
  {
    id: 'docker-layer-cache',
    match: /(dockerfile|docker|докер)/i,
    requireAny: [/\b(?:run|copy|add)\b|сло[йяеёв]|layer|cache|кэш/i],
    guidance: [
      'RUN выполняет команду и сохраняет изменения файловой системы в слой; COPY и ADD добавляют файлы в отдельные слои. Docker проверяет кэш последовательно по инструкциям. Если изменился шаг или входные файлы COPY, этот шаг и последующие шаги придётся выполнить заново.',
      'Чтобы чаще попадать в кэш, сначала добавляй редко меняющиеся файлы зависимостей и устанавливай зависимости, а исходники копируй ближе к концу. Само число шагов не делает образ огромным: важен объём файлов в слоях. Если удалить файл в следующем слое, данные предыдущего слоя останутся в образе; установку и очистку временных файлов поэтому обычно делают в одном RUN. Не склеивай команды без разбора.',
    ],
    english: [
      'RUN executes a command and saves filesystem changes in a layer; COPY and ADD add files in their own layers. Docker checks the cache in order. If a step or its COPY input changes, that step and the steps after it must run again.',
      'For better cache reuse, add rarely changed dependency files and install them before copying source code. The number of steps alone does not make an image huge; the files in the layers determine most of its size. Deleting a file in a later layer does not remove it from an earlier one, so install and cleanup are often done in one RUN. Do not combine commands blindly.',
    ],
  },
  {
    id: 'registry-retention',
    match: /(container registry|docker registry|registry|реестр|garbage collection|image tags?|образы.{0,20}ветк|registry.{0,20}cleanup)/i,
    requireAny: [/(registry|реестр|образ|image|тег|tag|garbage|collect|очист|retention)/i],
    guidance: [
      'Тегируй сборки commit SHA, а образы merge request и временных веток считай временными. Теги main и релизов храни отдельно и защити от очистки, если на них могут ссылаться запущенные сервисы или план отката. Политику настрой так, чтобы она удаляла только старые временные теги; сначала проверь её правила на текущем списке тегов.',
      'Удаление тега и освобождение места могут быть разными этапами. Например, в GitLab cleanup policy удаляет теги, а неиспользуемые слои удаляются отдельной garbage collection позже. Точные правила и сроки зависят от registry, поэтому не обещай, что место освободится сразу после удаления тега.',
    ],
    english: [
      'Tag each build with its commit SHA. Treat merge request and feature branch images as temporary, and keep main and release tags protected if running services or rollback may use them. Set cleanup to remove only old temporary tags, and check the rule against the current tags first.',
      'Removing a tag and freeing the layer data can be separate steps. In GitLab, a cleanup policy removes tags, while garbage collection removes unused layers later. The exact rules and timing depend on the registry, so do not promise that space is freed right away.',
    ],
  },
  {
    id: 'docker-expose',
    match: /(dockerfile|docker|докер|expose|экспоуз)/i,
    requireAny: [/(expose|экспоуз|неверн.{0,20}порт|wrong port|publish|опубликов|порт.{0,20}контейнер)/i],
    guidance: [
      'EXPOSE в Dockerfile только документирует порт, который приложение должно слушать внутри контейнера. Сам по себе он не открывает порт на хосте и не запускает приложение. Неверный EXPOSE не обязательно ломает запуск, если приложение и реальное перенаправление портов настроены правильно.',
      'Проверь, на каком порту процесс реально слушает внутри контейнера и как порт проброшен: docker run -p host:container, ports в Compose или Service targetPort в Kubernetes. Не путай внутренний порт с портом хоста; без -p EXPOSE порт наружу не публикует.',
    ],
    english: [
      'EXPOSE in a Dockerfile documents the port the app should use inside the container. It does not publish a host port or start the app. A wrong EXPOSE value alone does not always stop the container.',
      'Check the port the process really listens on, then check the mapping: docker run -p host:container, Compose ports, or a Kubernetes Service targetPort. EXPOSE alone does not make the port reachable from outside.',
    ],
  },
  {
    id: 'containers-vms',
    match: /(container|контейнер|docker|докер|virtual machine|виртуальн|\bvm\b|kubernetes|кубер)/i,
    requireAll: [/(container|контейнер|docker|докер)/i, /(\bvm\b|virtual machine|виртуальн)/i],
    guidance: [
      'Контейнеры разделяют ядро хоста и изолируют процесс через namespaces/cgroups; виртуальная машина запускает отдельную гостевую ОС поверх гипервизора.',
      'Контейнер обычно легче и быстрее стартует, но слабее отделён от ядра хоста; VM тяжелее, зато даёт более сильную изоляцию и может запускать другую ОС/ядро.',
      'В ответе полезно назвать практический выбор: контейнер - упаковка и масштабирование сервиса, VM - сильная изоляция, разные ОС или legacy-нагрузки.',
    ],
  },
  {
    id: 'argo-cd',
    match: /(?:argo\s*cd|argocd|арго\s*си\s*ди)/i,
    guidance: [
      'Argo CD - это GitOps-контроллер для Kubernetes, а не CI-пайплайн сборки. Объект Application связывает источник манифестов в Git (репозиторий, путь и revision) с целевым кластером и namespace.',
      'Контроллер сравнивает желаемое состояние из Git с состоянием кластера, показывает OutOfSync и вручную или по sync policy применяет изменения. CI отдельно может собрать и проверить образ, а затем обновить манифест или тег образа в Git.',
      'Не называй Application пайплайном и не приписывай кандидату опыт с Argo CD, если этого нет в его реальном опыте.',
    ],
    english: [
      'Argo CD is a GitOps controller for Kubernetes, not a CI build pipeline. An Application connects a Git source (repository, path, and revision) to a target cluster and namespace.',
      'The controller compares the desired state in Git with the live cluster state. It reports OutOfSync and can sync changes by hand or by sync policy. CI can build and test an image, then update its tag in Git.',
      'Do not call an Application a build pipeline or claim the candidate used Argo CD unless their real background says so.',
    ],
  },
  {
    id: 'object-storage',
    match: /(object storage|объектн\w* хранилищ|\bminio\b|\bceph\b)/i,
    guidance: [
      'Объектное хранилище хранит объекты по ключам внутри bucket и обычно доступно через HTTP API; это не обычная файловая система с теми же операциями. MinIO можно развернуть самостоятельно и работать с ним через S3-совместимый API.',
      'Для реальной эксплуатации нужно отдельно продумать доступы, TLS, диски и отказоустойчивость, версии и lifecycle объектов, backup и восстановление. Не утверждай, что кандидат сам ставил MinIO или Ceph, если этого нет в его профиле.',
    ],
    english: [
      'Object storage keeps objects under keys in buckets and is usually accessed through an HTTP API. It is not the same as a normal file system. MinIO is a self-hosted server with an S3-compatible API.',
      'For production, plan access, TLS, disks and redundancy, object versioning, backups, and restore tests. Do not claim the candidate installed MinIO or Ceph unless the profile says so.',
    ],
  },
  {
    id: 'vault-auth',
    match: /(hashi?corp\s*vault|vault|валт|волт)/i,
    requireAny: [/(approle|app.?role|role.?id|secret.?id|jwt|oidc|token|секрет|токен|аутентификац)/i],
    variants: [{
      match: /\bgitlab\b[\s\S]*\b(?:jwt|id[ -]?tokens?)\b|\b(?:jwt|id[ -]?tokens?)\b[\s\S]*\bgitlab\b/i,
      guidance: [
        'GitLab CI job передаёт ID token и имя Vault-роли в auth/<mount>/login. По умолчанию это auth/jwt/login; другой mount задаётся через VAULT_AUTH_PATH. Vault проверяет подпись GitLab, issuer, срок действия, audience (aud совпадает с bound_audiences роли) и настроенные bound claims, например project_id и ветку.',
        'При успешной проверке job получает отдельный Vault-токен с политиками и сроком жизни, заданными для роли. Этим токеном job читает разрешённые секреты; ID token и Vault-токен не одно и то же.',
        'Kubernetes auth по умолчанию auth/kubernetes/login проверяет токен сервисного аккаунта Kubernetes, а не GitLab ID token. Запуск runner в Kubernetes сам по себе не меняет способ входа с JWT на Kubernetes auth. Не смешивай эти способы и не придумывай настройку, которой нет в вопросе.',
        'Если спрашивают, что проверяет Vault, не опускай bound claims роли: например, project_id и ветку. Подпись, issuer, audience и срок действия сами по себе не ограничивают доступ нужным проектом. Назови политики роли как источник прав выданного токена.',
      ],
      english: [
        'A GitLab job sends its ID token and Vault role name to auth/<mount>/login, by default auth/jwt/login. VAULT_AUTH_PATH can select another mount. Vault checks the GitLab signature, issuer, expiry, audience (aud must match the role bound_audiences), and configured bound claims such as project_id and branch.',
        'Vault returns a separate token with the role policies and lifetime. The job uses that token to read permitted secrets. The GitLab ID token is not the Vault token.',
        'Kubernetes auth, by default auth/kubernetes/login, checks a Kubernetes service-account token, not a GitLab ID token. A runner running in Kubernetes does not by itself change JWT login to Kubernetes auth. Keep these methods separate and do not invent a setup absent from the question.',
        'If asked what Vault checks, include the role bound claims, for example project_id and branch. Signature, issuer, audience and expiry alone do not limit access to the right project. Name the role policies as the source of the new token access.',
      ],
    }],
    guidance: [
      'AppRole - способ аутентификации машин в Vault. Обычно клиент передаёт RoleID и SecretID в auth/approle/login, а Vault выдаёт токен с политиками и сроком жизни, заданными для роли.',
      'GitLab CI может войти в Vault иначе: job передаёт ID token (JWT), а Vault проверяет его claims и назначает подходящую роль и политики. Не смешивай JWT-поток с парой RoleID/SecretID; называй только тот способ, который подтверждён вопросом или контекстом.',
      'Не называй SecretID готовым Vault-токеном. Не утверждай, что любая интеграция Ansible использует JWT или AppRole без подтверждения.',
    ],
    english: [
      'AppRole is a machine login method for Vault. By default, the client sends a RoleID and SecretID to auth/approle/login. Vault then returns a token with the role policies and token lifetime.',
      'GitLab CI can use a different flow: the job sends an ID token (JWT), and Vault checks its claims before giving access. Do not mix this with the RoleID and SecretID flow.',
      'A SecretID is not a Vault token. Do not guess which login method Ansible uses unless the question or candidate background confirms it.',
    ],
  },
  {
    id: 'ansible-roles-and-handlers',
    match: /ansible|ансибл/i,
    requireAny: [/(role|роль|notify|handler|хендлер|default|vars|переменн|extra.?vars)/i],
    guidance: [
      'Роль Ansible собирает переиспользуемую логику и файлы по понятным частям: tasks, handlers, templates, files и переменные. Для маленькой разовой задачи хватит playbook; роль полезна, когда логику надо повторять, тестировать и поддерживать отдельно.',
      'notify ставит handler в очередь, когда задача завершилась со статусом changed. Handler обычно запускается в конце секции задач и выполняется один раз, даже если его уведомили несколько задач. Это удобно, например, чтобы перезапустить сервис только после изменения конфига.',
      'Переменные role defaults имеют низкий приоритет и рассчитаны на переопределение. role vars приоритетнее inventory и defaults, а extra vars (-e) имеют самый высокий приоритет. Для ответа достаточно объяснить направление приоритета, не перечисляя все уровни.',
    ],
    english: [
      'An Ansible role groups reusable tasks, handlers, templates, files, and variables. A small one-off play can stay in a playbook; a role helps when the logic should be reused, tested, and maintained separately.',
      'A task queues a handler with notify when the task reports changed. Handlers normally run at the end of the task section and run once even if several tasks notify them. This is useful for restarting a service only after its config changes.',
      'Role defaults have low precedence and are meant to be overridden. Role vars have higher precedence than inventory and defaults; extra vars (-e) have the highest precedence. Explain the direction rather than listing every level.',
    ],
  },
  {
    id: 'nifi-dataflow',
    match: /(?:apache\s*)?nifi|нифи/i,
    guidance: [
      'Apache NiFi строит поток обработки данных из компонентов. Processor забирает, преобразует, проверяет или отправляет FlowFile; FlowFile несёт содержимое и атрибуты; connection соединяет processor и буферизует очередь между ними. Потоки и очереди можно наблюдать и ограничивать.',
      'Объясняй NiFi как инструмент для сборки и контроля dataflow между системами. Не называй его базой данных, брокером сообщений или просто CI-пайплайном.',
    ],
    english: [
      'Apache NiFi builds data flows from components. A processor reads, transforms, checks, or sends a FlowFile. A FlowFile carries content and attributes; a connection links processors and buffers a queue between them. Flows and queues can be monitored and limited.',
      'Describe NiFi as a tool to build and control data flows between systems. Do not call it a database, message broker, or CI pipeline.',
    ],
  },
  {
    id: 'rabbitmq-kafka',
    match: /(rabbit\s*mq|rabbitmq|rebin\.?mq|kafka|кафка)/i,
    guidance: [
      'RabbitMQ обычно маршрутизирует сообщения через exchange в очереди; потребители получают сообщения из очередей и подтверждают обработку. Kafka хранит записи в partitioned log топиков, а consumer group читает их по offset.',
      'Не своди разницу только к push против pull: Kafka consumers вызывают poll, RabbitMQ обычно доставляет сообщения подписанным consumers, но у RabbitMQ также есть получение по запросу. Сравнивай модель хранения, маршрутизацию, повторное чтение и ack/offset.',
      'В обычной очереди RabbitMQ подтверждение позволяет убрать сообщение из очереди. В Kafka commit offset только сохраняет место чтения и НЕ удаляет записи топика. Хранение задают retention и compaction независимо от чтения; порядок гарантируется внутри partition, а не всего топика.',
      'В consumer group одна partition назначается не более чем одному активному consumer этой группы; число работающих consumers ограничено числом partition. Группы ведут offsets независимо друг от друга.',
      'Чтение транзакционных записей зависит от isolation.level. По умолчанию read_uncommitted допускает даже записи открытых или отменённых транзакций. read_committed отдаёт только подтверждённые транзакционные записи и не проходит за LSO, границу первой открытой транзакции. Commit offset отдельно сохраняет прогресс группы, а не делает записи видимыми.',
    ],
    english: [
      'RabbitMQ routes messages through exchanges into queues; consumers acknowledge deliveries. Kafka stores records in topic partitions; a consumer group reads them by offset.',
      'Kafka consumers poll; RabbitMQ usually pushes to subscribed consumers, though basic.get can fetch. Compare routing, storage and replay, not just push versus pull.',
      'Each partition has one active consumer per group; different groups have independent offsets.',
      'read_uncommitted is the default and can return records from open or aborted transactions. read_committed returns committed transaction records and cannot pass the LSO, the boundary of the first open transaction. Offset commit only saves group progress; it does not make records visible.',
      'Topic records are removed by retention or compaction, independently of reading and offset commits. Ordering is per partition, not global across a topic.',
    ],
    variants: [{
      match: /(?:транзакц|transaction|read_committed|read_uncommitted|isolation\.level|\bLSO\b)/iu,
      guidance: [
        'Не отвечай просто «да» или «нет», если isolation.level не указан. Consumer вызывает poll. По умолчанию read_uncommitted позволяет читать даже записи открытых или отменённых транзакций. Commit offset только сохраняет позицию группы, а не разрешает чтение.',
        'В read_committed записи открытой транзакции недоступны до её завершения, а отменённые пропускаются. Чтение не идёт за LSO, границу первой открытой транзакции в partition. Записи после этой границы, даже нетранзакционные, тоже ждут завершения транзакции. Более ранние доступные записи poll по-прежнему возвращает; весь consumer не обязан стоять. Не говори, что открытая транзакция запрещает читать более ранние доступные записи или блокирует все partition.',
        'Kafka-to-Kafka транзакция может атомарно записать результат в несколько partition и связать его с offsets. Это не делает Kafka обычной реляционной БД с произвольными транзакциями.',
      ],
      english: [
        'If isolation.level is not given, explain both modes, not a blanket yes or no. Each consumer group reads them by offset, using poll. The default, read_uncommitted, can return open or aborted transaction records. Offset commit saves group progress; it does not allow reading and never removes topic records.',
        'read_committed waits to expose open transaction records and skips aborted ones. It cannot pass the LSO, the first open transaction boundary in a partition. Later records, even ordinary ones, wait too. Earlier available records can still be returned by poll; the whole consumer does not have to stop. Do not claim an open transaction prevents reading earlier available records or blocks all partitions.',
        'Kafka-to-Kafka transactions can atomically write output to multiple partitions and commit offsets together. This does not make Kafka a relational database with arbitrary transactions.',
      ],
    }],
  },
  {
    id: 'canary-traffic',
    match: /(canary|канареечн)/i,
    guidance: [
      'Canary даёт новой версии часть запросов, пока старая продолжает работать. При наличии traffic router долю задают весами маршрутов в ingress, gateway или service mesh; без такого маршрутизатора долю лишь приближённо получают соотношением реплик.',
      'Pipeline может менять веса или вызывать rollout controller, но GitLab CI и Argo CD сами HTTP-трафик не делят. Не называй конкретный продукт, если он не указан в вопросе или подтверждённом опыте.',
      'Долю увеличивают по согласованным шагам после сравнения ошибок, задержки и нужных бизнес-метрик с прежней версией за достаточный период. При ухудшении шаг останавливают и возвращают трафик старой версии. Не придумывай универсальные шаги по 10% или время ожидания.',
    ],
    english: [
      'A canary gets part of the requests while the old version keeps running. With a traffic router, route weights set the share in an ingress, gateway, or service mesh. Without a router, the number of pods only gives a rough split.',
      'A pipeline can change weights or call a rollout controller. GitLab CI and Argo CD do not split HTTP traffic by themselves. Do not claim a specific tool unless it was given.',
      'Raise the share in planned steps after comparing errors, response times, and key business metrics with the old version. Stop and send traffic back to the old version if results get worse. There is no universal 10% step or wait time.',
    ],
  },
  {
    id: 'cicd',
    match: /(ci\/cd|cicd|continuous integration|continuous delivery|continuous deployment|непрерывн|пайплайн|pipeline|депло[ий])/i,
    requireAny: [/(ci\/cd|cicd|continuous|непрерывн|pipeline|пайплайн)/i],
    guidance: [
      'CI - автоматическая проверка изменений: сборка, тесты, линтеры, статический анализ, иногда сборка артефакта.',
      'CD в delivery означает, что артефакт готов к релизу после ручного подтверждения; deployment - автоматический выпуск в среду.',
      'В production стоит упоминать gates: review, миграции, canary/blue-green, rollback и наблюдаемость после выката.',
    ],
  },
  {
    id: 'grpc',
    match: /(gRPC|GRPC|джиарпис|грпс)/i,
    guidance: [
      'gRPC позволяет сервисам вызывать методы друг друга по HTTP/2. Контракт обычно задают в .proto, данные передают через Protocol Buffers. Не утверждать, что gRPC всегда быстрее REST.',
      'При сбое сначала смотреть конкретный статус вызова и deadline. Для UNAVAILABLE проверить доступность сервиса, endpoints и путь через прокси; для DEADLINE_EXCEEDED проверить задержку и таймаут. Проверять причину по логам и метрикам, не угадывать её.',
    ],
    english: [
      'gRPC lets services call each other over HTTP/2. A .proto file usually defines the API, and Protocol Buffers carry the data. It is not always faster than REST.',
      'For a failure, first check the call status and deadline. UNAVAILABLE may mean a connection or service problem; DEADLINE_EXCEEDED means the call took too long. Check logs and metrics before naming a cause.',
    ],
    variants: [{
      match: /(?:очеред|message\s+queue|broker|RabbitMQ|Kafka)/iu,
      guidance: [
        'Для сравнения gRPC и очереди объясни выбор связи, не добавляй диагностику сбоя. gRPC вызывает метод другого сервиса по HTTP/2; описание API обычно в .proto, данные в Protocol Buffers. Если результат нужен прямо сейчас, сервис ждёт ответ вызова. API бывает синхронным и асинхронным, поэтому gRPC не всегда блокирует поток.',
        'Очередь подходит для работы, которую другой сервис выполнит позже, например отправки письма после заказа. Подтверждение приёма брокером не означает, что обработка закончилась; результат нужно передать отдельно. Не обещай, что очередь гарантирует отсутствие ожидания или что gRPC всегда быстрее.',
      ],
      english: [
        'Compare the choice of service link; do not add failure checks. gRPC calls another service over HTTP/2; .proto usually defines the API and Protocol Buffers carry data. Use it when the result is needed now. The API can be sync or async; waiting for a result does not always block a thread.',
        'Use a queue for work handled later, such as sending an email after an order. A broker receipt is not proof that work is done; send a result separately if needed. Do not claim all gRPC calls block or that a queue guarantees no waiting.',
      ],
    }],
  },
]

function matchesTopic(topic, text) {
  if (!topic.match.test(text)) return false
  return (!topic.requireAny || topic.requireAny.some(pattern => pattern.test(text)))
    && (!topic.requireAll || topic.requireAll.every(pattern => pattern.test(text)))
}

export function lookupDomainKnowledge(messages = [], focus = '', language = 'ru', { maxTopics = 2, maxChars = Infinity } = {}) {
  const texts = messages.map(message => message?.text || '')
  const text = [...texts, focus || ''].join('\n')
  const hits = TOPICS
    .filter(topic => matchesTopic(topic, text) && (language !== 'en' || topic.english))
    .map(topic => ({
      topic,
      relevance: texts.filter(message => matchesTopic(topic, message)).length,
    }))
    .sort((a, b) => b.relevance - a.relevance || TOPICS.indexOf(a.topic) - TOPICS.indexOf(b.topic))
    .slice(0, Math.max(0, maxTopics))
  const sections = []
  let usedChars = 0
  for (const { topic } of hits) {
    const details = topic.variants?.find(variant => variant.match.test(text)) || topic
    const section = `${language === 'en' ? 'Topic' : 'Тема'} ${topic.id}:\n- ${(language === 'en' ? details.english : details.guidance).join('\n- ')}`
    const separatorLength = sections.length ? 1 : 0
    if (usedChars + separatorLength + section.length > maxChars) continue
    sections.push(section)
    usedChars += separatorLength + section.length
  }
  return sections.join('\n')
}
