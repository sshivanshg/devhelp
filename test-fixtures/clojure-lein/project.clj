(defproject my-app "0.1.0-SNAPSHOT"
  :description "A Clojure application"
  :min-lein-version "2.0.0"
  :dependencies [[org.clojure/clojure "1.11.1"]
                 [ring/ring-core "1.11.0"]
                 [compojure "1.7.1"]]
  :plugins [[lein-ring "0.12.5"]]
  :ring {:handler myapp.handler/app}
  :profiles {:dev {:dependencies [[ring/ring-mock "0.4.0"]]}})
