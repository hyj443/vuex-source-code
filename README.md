# 逐行解析Vuex源码

## Vuex 背后的基本思想

### 查询和更新的分离
Vuex 很重要的一个特点是，实现查询和更新的分离：

1. 如果一个方法修改了对象的 state，那它就是一个 command 命令，并不返回值。
2. 如果一个方法返回了值，那它就是一个 query 查询，并不修改 state。

这保证了状态以一种“可预测”的方式变化。

Vuex 把组件间需要共享的 state 抽取出来，以一个全局的 store 的单例模式统一管理。从而构成一个“状态树”，任何组件都能获取状态或触发状态的更新。

### Vuex 和单纯的全局对象的不同在于

1. Vuex 的 state 是响应式的，当组件从 store 中读取状态时，如果状态发生变化，则相应的组件也会更新，这就是 query 的一种实现。
2. 不能直接修改 store 中的状态，改变它的唯一方式是提交 mutation，这样使我们可以方便地追踪每一个状态的变化，这就是 command 的一种实现。

Vuex 并没有实现一套响应式系统，而是借用了 Vue 的 API 实现数据的响应式化，所以 Vuex 要 配合 Vue 使用，不适合非 Vue 框架。

## Vuex的安装

> 在一个模块化的打包系统中，必须在 new Vue() 之前调用 Vue.use() 才能使用 Vuex 插件：

```js
import Vue from 'vue';
import Vuex from 'vuex';
Vue.use(vuex);
new Vue({
  // ...
})
```

> 安装 Vue.js 插件。如果插件是一个对象，它必须提供 install 方法。如果插件是一个函数，则它会被作为 install 方法。install 方法调用时，会将 Vue 作为参数传入。

入口文件 src\index.js 默认导出的对象：

```js
export default {
  Store,
  install,
  version: '__VERSION__',
  mapState,
  mapMutations,
  mapGetters,
  mapActions,
  createNamespacedHelpers
}
```
可以看到 Vuex 对外暴露的 API，有 Store 构造函数，有 install 方法。Vue.use 执行，会调用插件的 install 方法，传入 Vue 构造函数。

```js
let Vue
// ....
export function install (_Vue) {
  if (Vue && _Vue === Vue) {
    if (process.env.NODE_ENV !== 'production') {
      console.error('[vuex] already installed. Vue.use(Vuex) should be called only once.')
    }
    return
  }
  Vue = _Vue
  applyMixin(Vue)
}
```
首次调用 install 时，本地 Vue 还未定义，传入的 Vue 构造函数赋给了它，避免打包时整个引入 Vue。

如果再次调用 install，Vue 已经有值且和传入的 Vue 相同，在开发环境下会打印警告：Vuex 已经安装过了，Vue.use(Vuex) 只调用一次。然后直接返回，避免插件的重复安装。

接着执行 applyMixin 函数做真正的安装：

```js
export default function (Vue) {
  const version = Number(Vue.version.split('.')[0])
  if (version >= 2) {
    Vue.mixin({ beforeCreate: vuexInit })
  } else {
    // Vue 1.x 的处理，不做分析
  }
}
``` 

Vue2.x 版本就调用 Vue.mixin，混入一个 beforeCreate 生命周期钩子: vuexInit。之后创建的每个 vm 实例，执行到 beforeCreate 钩子时都会调用 vuexInit。

```js
function vuexInit () {
  const options = this.$options
  if (options.store) {
    this.$store = typeof options.store === 'function'
      ? options.store()
      : options.store
  } else if (options.parent && options.parent.$store) {
    this.$store = options.parent.$store
  }
}
```

vuexInit 函数中 this 指向当前 vm 实例，首先获取实例的 $options 对象。如果 $options.store 存在，说明实例化 Vue 时传了 store。只有在创建根 Vue 实例时，才会传入 store 对象：

```js
new Vue({
  store, // 传入store对象
  render: h => h(App)
}).$mount('#app')
```

说明当前 Vue 实例是根实例，于是给根实例添加 $store 属性，值为 options.store() 或 options.store，取决于传入的 store 是否为函数。

如果当前不是根实例，但它有父实例且父实例的 $store 有值，那么也给当前实例添加 $store 属性，值取父实例的 $store 值。

因为每个 vm 实例的生命周期都会执行 vuexInit 钩子，所以根实例和子实例都添加了 $store 属性，属性值指向同一个 store 对象，即 new Vue 时传的 store 对象。因此在任意组件中都可以通过 this.$store 访问到它。

vue-router 是给 Vue.prototype 添加 $router，让每个 Vue 实例都能获取 $router。Vuex 是先给根 Vue 实例添加 $store，然后在每一个子实例创建时，从父实例上取 $store 值。因为组件的创建是自上而下进行的，所以根实例注册的 store 对象向下注入到各个组件实例中。

## store 对象的创建

那么这个 store 对象是怎么来的？

```js
const store = new Vuex.Store({
  state,
  mutations,
  actions,
  getters,
  modules
})
```

它是通过实例化 Vuex.Store 创建的，传入一个配置对象，可以包含 actions、getters、state、mutations、modules 等

我们分段来看 Store 这个构造函数：

```js
class Store {
  constructor(options = {}) {
    if (!Vue && typeof window !== 'undefined' && window.Vue) {
      install(window.Vue)
    }
    if (process.env.NODE_ENV !== 'production') {
      assert(Vue, `must call Vue.use(Vuex) before creating a store instance.`)
      assert(typeof Promise !== 'undefined', `vuex requires a Promise polyfill in this browser.`)
      assert(this instanceof Store, `store must be called with the new operator.`)
    }
    // ……
  }
  // ……
}
```

如果本地 Vue 没有值，且处在浏览器环境，且 window.Vue 存在，则执行 install(window.Vue)。这意味着，如果使用全局 `<script>` 标签引用 Vuex，不需要用户手动调用 Vue.use(Vuex)，它能主动调用 install 安装。

Vuex 的使用需要一些前提条件。在开发环境中，会执行 3 个断言函数，如果条件不具备则会抛错。

```js
export function assert (condition, msg) {
  if (!condition) throw new Error(`[vuex] ${msg}`)
}
```
3个断言函数所做的事是：

1. 如果本地 Vue 没有值，抛出错误：实例化 Store 之前必须调用 Vue.use(Vuex)。
2. 如果 Promise 不能用，抛出错误：Vuex 需要 Promise polyfill。
3. 如果 Store 函数里的 this 不是 Store 的实例，抛出错误：Store 必须用 new 调用。

判断完环境后，开始往 Store 实例挂载一些属性：

```js
const { plugins = [], strict = false } = options
this._committing = false // 提交mutation的标志
this._actions = Object.create(null) // 存放用户定义的所有actions
this._actionSubscribers = [] // action订阅函数集合
this._mutations = Object.create(null) // 存放用户定义的所有mutations
this._wrappedGetters = Object.create(null) // 存放用户定义的所有getters
this._modules = new ModuleCollection(options) // module收集器
this._modulesNamespaceMap = Object.create(null) // 模块命名空间
this._subscribers = [] // 所有mutation的订阅函数
this._watcherVM = new Vue() // Vue实例，利用它的$watch方法来观测变化 
this._makeLocalGettersCache = Object.create(null)//存放生成的本地getters的缓存
// ...
```

其中的重点是：`this._modules = new ModuleCollection(options)`，稍后会仔细介绍 new ModuleCollection 做了什么事情，继续看 Store：
 
```js
const store = this
const { dispatch, commit } = this
this.dispatch = function boundDispatch (type, payload) {
  return dispatch.call(store, type, payload)
}
this.commit = function boundCommit (type, payload, options) {
  return commit.call(store, type, payload, options)
}
```

首先 store 变量保存当前 store 实例。然后分别对 Store 原型的 dispatch 和 commit 方法进行缓存。然后给 store 实例添加 dispatch 和 commit 方法，它们分别实际调用原型的 dispatch 和 commit 方法，这保证了执行时的 this 始终指向当前 store 实例。

这便于 commit 和 dispatch 在别的函数内调用，比如在 dispatch 里调用 commit，或者在 mutation handler 中调用 commit 提交另一个 mutation，执行时的 this 不受影响，始终指向 store 实例。

接着看 Store 构造函数：

```js
this.strict = strict // options的strict值赋给实例的strict
const state = this._modules.root.state
installModule(this, state, [], this._modules.root)
resetStoreVM(this, state)
plugins.forEach(plugin => plugin(this))
```

已知，this._modules 是 ModuleCollection 的实例，我们稍后会讲到它的 root 其实是根 module 对象，根 module 的 state 属性值是根state，这里获取根 state。

调用 installModule 进行模块的注册安装，传入 store 实例、根state、[]、根 module。

调用 resetStoreVM 函数，对 state 进行响应式化处理。

遍历 plugins 数组，逐个调用 Vuex 自己的插件函数。

到目前为止，Store 构造函数已经过了一遍。new Store 主要做了三件事：

1. 初始化一些内部属性，重点是 this._modules = new ModuleCollection(options)
2. 执行 installModule，安装模块
3. 执行 resetStoreVM，使store响应式化

我们将逐个细说这三个，我们先看实例化 Store 时配置对象该怎么传：

## Store 对象该怎么传

```js
this._modules = new ModuleCollection(options)

class ModuleCollection {
  constructor (rawRootModule) {
    this.register([], rawRootModule, false)
  }
}
```
new ModuleCollection(options) 会调用 register 函数。
```js
register (path, rawModule, runtime = true) {
  if (process.env.NODE_ENV !== 'production') {
    assertRawModule(path, rawModule)
  }
  // ...
}
```
生产环境下，会调用 assertRawModule 函数，对用户传入的配置对象做规范化校验。

```js
function assertRawModule (path, rawModule) {
  Object.keys(assertTypes).forEach(key => {
    if (!rawModule[key]) return
    const assertOptions = assertTypes[key]
    forEachValue(rawModule[key], (value, type) => {
      assert(
        assertOptions.assert(value),
        makeAssertionMessage(path, key, type, value, assertOptions.expected)
      )
    })
  })
}
```
首先会获取 assertTypes 的自有属性组成的数组，我们看看 assertTypes 对象：

```js
const functionAssert = {
  assert: value => typeof value === 'function',
  expected: 'function'
}
const objectAssert = {
  assert: value => typeof value === 'function' ||
    (typeof value === 'object' && typeof value.handler === 'function'),
  expected: 'function or object with "handler" function'
}
const assertTypes = {
  getters: functionAssert,
  mutations: functionAssert,
  actions: objectAssert
}
```
可见，Object.keys(assertTypes) 就是 ['getters','mutations','actions']

```js
Object.keys(assertTypes).forEach(key => {
    if (!rawModule[key]) return
    const assertOptions = assertTypes[key]
    forEachValue(rawModule[key], (value, type) => {
      assert(
        assertOptions.assert(value),
        makeAssertionMessage(path, key, type, value, assertOptions.expected)
      )
    })
  })
```
遍历该数组，执行回调，首先如果当前配置对象中不存在当前遍历的属性，直接返回。比如配置对象中没有传 actions，则不用校验 actions。
 
否则，获取 assertTypes 对象中对应的属性值，赋给 assertOptions，比如 'getters' 的属性值就是 functionAssert 对象

接着调用 forEachValue 函数对 key 对应的配置对象进行遍历。我们先看看 forEachValue 函数：

```js
export function forEachValue (obj, fn) {
  Object.keys(obj).forEach(key => fn(obj[key], key))
}
```

forEachValue 函数会遍历传入的 obj 对象的自有属性 key，逐个调用 fn。
```js
forEachValue(rawModule[key], (value, type) => {
  assert(
    assertOptions.assert(value),
    makeAssertionMessage(path, key, type, value, assertOptions.expected)
  )
})
```
所以 forEachValue 会遍历配置对象中 key 对应的属性值对象，执行回调，在回调中执行 assert 函数：如果 assertOptions.assert(value) 返回 false，则会抛出错误，错误提示内容由 makeAssertionMessage 函数生成。

当 key 为 'getters' 或 'mutations'，则 assertOptions.assert 函数为：`value => typeof value === 'function'`

意味着，用户传的 getters 和 mutations 对象中的属性值需要传函数，否则会抛错。

当 key 为 'actions'，则 assertOptions.assert 函数就是：

```js
value => typeof value === 'function' ||
    (typeof value === 'object' && typeof value.handler === 'function')
```

这表明，用户传的 actions 对象中的属性值可以是函数，也可以是包含 handler 函数的对象，否则就会抛错。

所以 assertRawModule 函数校验用来户传入的 getters、mutations、actions 对象，如果没有按要求传就会抛错，给出提示。

## Module 收集

> store 使用单一的状态树，用一个对象包含了全部的应用层级的状态，每个应用将仅仅包含一个 store 实例。

如果应用变得很复杂，store 对象就可能很臃肿。为了解决这个问题，Vuex 允许我们将 store 分割成模块，每个模块都有自己的 state 、mutation、action、getter、甚至是嵌套模块，像下面这样从上至下进行同样方式的分割：

```js
const moduleA = {
  state: { ... },
  mutations: { ... },
  actions: { ... },
  getters: { ... }
}
const moduleB = {
  state: { ... },
  mutations: { ... },
  actions: { ... }
}
const store = new Vuex.Store({
  modules: {
    a: moduleA,
    b: moduleB
  }
})
store.state.a // -> moduleA 的状态
store.state.b // -> moduleB 的状态
```

如果把 store 本身看作是根 module，它有嵌套的子 module，形成一种用配置对象描述的树形结构。模块的收集其实就是 new ModuleCollection 实现的。

```js
class ModuleCollection {
  constructor (rawRootModule) {
    this.register([], rawRootModule, false)
  }
  register (path, rawModule, runtime = true) {
    if (process.env.NODE_ENV !== 'production') {
      assertRawModule(path, rawModule)
    }
    const newModule = new Module(rawModule, runtime)
    if (path.length === 0) {
      this.root = newModule
    } else {
      const parent = this.get(path.slice(0, -1))
      parent.addChild(path[path.length - 1], newModule)
    }
    if (rawModule.modules) {
      forEachValue(rawModule.modules, (rawChildModule, key) => {
        this.register(path.concat(key), rawChildModule, runtime)
      })
    }
  }
  // ...
}
```
register 原型方法接收的 3 个参数：

1. path：模块路径，是模块配置对象的属性名组成的数组，是模块的唯一标识。像刚刚的例子，根模块的 path 为 []，它的子模块 moduleA 的 path 是 ['a']，子模块 moduleB 的 path 是 ['b']，如果它们各自还有子模块，则它们的 path 就大致形如 ['a','a1']、['b','b1']
2. rawModule：当前模块的配置对象。rawRootModule 就是实例化 Store 时传入的配置对象。我们把创建的 store 对象看作是根 module，它的配置对象看作根 module 的配置对象。
3. runtime 表示是否是一个运行时创建的 module，默认为 true。

```js
this.register([], rawRootModule, false)
```
new ModuleCollection(options) 调用 register，第一个参数传 []，说明注册的是根 module。rawRootModule 是实例化 Store 时传入的配置对象。

我们具体分段看 register 的内部：

```js
if (process.env.NODE_ENV !== 'production') { // 对配置对象做规范化校验
  assertRawModule(path, rawModule)
}
const newModule = new Module(rawModule, runtime)
if (path.length === 0) {
  this.root = newModule
} else {
  const parent = this.get(path.slice(0, -1))
  parent.addChild(path[path.length - 1], newModule)
}
```

new Module 根据当前的配置对象，创建了一个 Module 实例，赋给 newModule。后面会详谈 Module 构造函数。

如果 path 是空数组，说明当前注册的是根 module，则把 newModule 赋给当前 ModuleCollection 的实例的 root 属性，即 root 属性保存了根 module 对象。

如果 path 不是空数组，则注册的是子 module，稍后会讲解。接着：

```js
if (rawModule.modules) {
  forEachValue(rawModule.modules, (rawChildModule, key) => {
    this.register(path.concat(key), rawChildModule, runtime)
  })
}
```
如果当前配置对象传了 modules，配置了嵌套模块，则遍历 modules 对象里的每个子模块名，递归调用 register，此时传入的路径是 path.concat(key)，path 是当前注册的模块的路径，concat 上当前遍历的 key，就是子模块的路径。第二个参数是子模块的配置对象。

我们现在捋一捋：实例化 Store 会实例化 MoudleCollection，调用 register 进行根 module 的注册，如果根配置对象配置了嵌套的子模块，会继续调用 register 注册子 module。此时 path 不是空数组，回到刚刚的 else 语句块:

```js
if (path.length === 0) {
  this.root = newModule
} else {
  const parent = this.get(path.slice(0, -1))
  parent.addChild(path[path.length - 1], newModule)
}
```

此时 path 是当前注册的子模块的路径，path.slice(0, -1) 去掉最后一项后，是父模块的 path。将它传入 get 方法执行，是为了获取该当前子模块的父 module 对象，我们看看 get 方法：

```js
get (path) {
  return path.reduce((module, key) => {
    return module.getChild(key)
  }, this.root)
}
```

reduce 的详细用法参考 [reduce - MDN](https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Reference/Global_Objects/Array/Reduce)

我们先看一下 getChild 和 addChild 这两个 Module 的原型方法，再回来理解 get。

```js
getChild (key) {
  return this._children[key]
}
addChild (key, module) {
  this._children[key] = module
}
```

getChild 方法返回 this._children[key]，即通过 key 获取到当前 module 的子 module 对象，我们讲 Module 构造函数时会讲 _children 属性。

addChild 方法是给当前 module 的 _children 对象，添加 key 和对应的子模块对象。

回到 get：

```js
get (path) {
  return path.reduce((module, key) => {
    return module.getChild(key)
  }, this.root)
}
```

为方便理解，假设传入 get 的 path 为 ['a','b','c']

reduce 累加器的初始值为 this.root，是根 module，第一次迭代中，执行回调返回 key 为 'a' 的子 module，并且该子 module 会作为下一次迭代的累加器的值，即传给回调的第一个参数 module，第二次迭代执行返回 'a' 模块的下的 'b' 子模块对象，以此类推，最后 get 方法返回 ['a','b','c'] 对应的模块。

所以 get 方法返回出 path 对应的 module 对象。

```js
 const parent = this.get(path.slice(0, -1))
 parent.addChild(path[path.length - 1], newModule)
```
path[path.length - 1]，path 数组的最后一项，即当前模块的 key 名，newModule 是当前模块对象，它们被添加到父模块对象的 _children 对象中。

可见 module 的 _children 属性，建立起父子模块对象之间的联系。树形结构的配置对象，转成了一个个散落的父子 module 对象。

概况来说，new ModuleCollection(执行register)，做了两件事：

1. 根据 rawModule 配置对象通过 new Module 创建 module 对象
2. 通过递归调用 register，建立父子 module 对象之间的父子关系

new Module 是在 new ModuleCollection 的过程中发生的，先生成 module 对象，再建立父子 module 对象的联系。

## Module 构造函数

用户定义模块的配置对象是未经加工的，传入 new Moudle 执行后，实现了从 rawModule 到 module 对象的转变。

```js
class Module {
  constructor (rawModule, runtime) {
    this.runtime = runtime
    this._children = Object.create(null)
    this._rawModule = rawModule
    const rawState = rawModule.state
    this.state = (typeof rawState === 'function' ? rawState() : rawState) || {}
  }
  get namespaced () {
    return !!this._rawModule.namespaced
  }
  // 原型方法后续会介绍
}
```
Module 的实例会挂载一些属性，比如 _children 对象用来存放当前 module 的子 module。_rawModule 属性保存当前模块的配置对象。

然后给 Module 实例添加 state 属性，先获取配置对象中 state 的属性值，如果它为函数，则执行返回值赋给实例的 state 属性，如果不是函数，直接赋给 state 属性，如果当前模块的配置对象没有传 state，则也赋为一个空对象

可见，用户声明模块的 state 可以传一个返回一个对象的函数，返回的对象会被赋给 this.state。

这和 Vue 组件里的 data 一样，如果使用一个纯对象来声明模块的state，则该 state 对象会通过引用被共享，导致 state 对象被修改时，store 或模块间数据相互污染。

因为有时我们可能需要创建一个模块的多个实例，比如，多次实例化 Store 创建多个 store 实例，或在一个 store 中多次注册同一个模块。

```js
get namespaced () {
  return !!this._rawModule.namespaced
}
```

namespaced 是 Module 的原型属性，通过 Module 实例读取 namespaced 属性会触发 get 方法，根据模块的配置对象的 namespaced 属性值返回真假，模块的 namespaced 值，代表当前模块是否开启了命名空间。

### installModule

讲完模块对象的创建和模块的收集，接着就是模块的安装，即这句：

```js
installModule(this, state, [], this._modules.root)
```
installModule 其实做了三件事：
1. 往 store._modulesNamespaceMap 对象中存入命名空间和对应的 module
2. 给模块的 state 添加子 state
3. 注册用户配置的 mutation getter 和 action
4. 递归注册子模块

```js
function installModule(store, rootState, path, module, hot) {
  const isRoot = !path.length 
  const namespace = store._modules.getNamespace(path) 
  // ...
}
```

installModule 函数接收什么参数：

- store：new Vuex.Store 时传入的 store 对象。
- rootState：根 state 对象
- path：当前的模块的路径数组
- module：当前模块对象
- hot：是否支持热重载（这里不讨论它）

installModule 代码较长，我们分段来看：

```js
const isRoot = !path.length
const namespace = store._modules.getNamespace(path)
```

首先，变量 isRoot 的真假代表当前模块是否为根模块。接着，调用 getNamespace 根据当前模块的 path 获取当前模块的命名空间。我们看看 getNamespace：

```js
getNamespace (path) {
  let module = this.root
  return path.reduce((namespace, key) => {
    module = module.getChild(key)
    return namespace + (module.namespaced ? key + '/' : '')
  }, '')
}
```
首先获取根 module 对象，然后调用 reduce，累加器初始值为''，每次迭代返回的字符串覆盖给 namespace，如果当前模块开启了命名空间，就将 namespace 拼上当前的模块名和'/'，否则拼接''。凡是开启了命名空间的模块，它的模块名都会被拼接到命名空间字符串中

迭代结束，namespace 获取到当前模块的命名空间字符串。

接着看 installModule：

```js
if (module.namespaced) {
  if (store._modulesNamespaceMap[namespace] && process.env.NODE_ENV !== 'production') {
    console.error(`[vuex] duplicate namespace ${namespace} for the namespaced module ${path.join('/')}`)
  }
  store._modulesNamespaceMap[namespace] = module
}
```

如果当前模块开启了命名空间，且命名空间字符串已经存在于 _modulesNamespaceMap 对象，后者是专门存放各个模块的命名空间字符串的对象，则在开发环境下报错提示：已经有模块的命名空间叫这个名字了。

如果不存在，则将命名空间字符串和它对应的 module 对象，添加到 _modulesNamespaceMap 对象中。

继续看 installModule 的代码：

```js
if (!isRoot && !hot) {
  const parentState = getNestedState(rootState, path.slice(0, -1))
  const moduleName = path[path.length - 1]
  store._withCommit(() => {
    if (process.env.NODE_ENV !== 'production') {
      if (moduleName in parentState) {
        console.warn(
          `[vuex] state field "${moduleName}" was overridden by a module with the same name at "${path.join('.')}"`
        )
      }
    }
    Vue.set(parentState, moduleName, module.state)
  })
}
```
如果当前模块不是根模块，且非热更新，执行 if 语句块。首先，调用 getNestedState 传入根 state 和父 path，获取当前模块的父 state。

```js
function getNestedState (state, path) {
  return path.reduce((state, key) => state[key], state)
}
```

父模块的 path 数组调用 reduce，累加器的初始值为根 state，每次迭代返回出它的子模块的 state，沿着 path 路径，一个个获取子 state，直到获取到当前 state 的父 state。就比如`store.state` >> `store.state.a` >> `store.state.a.b`...

`const moduleName = path[path.length - 1]` 获取到当前模块的模块名

接着调用 store._withCommit，传入回调函数，这个回调函数做了什么：

```js
store._withCommit(() => {
  if (process.env.NODE_ENV !== 'production') {
    if (moduleName in parentState) {
      console.warn(
        `[vuex] state field "${moduleName}" was overridden by a module with the same name at "${path.join('.')}"`
      )
    }
  }
  Vue.set(parentState, moduleName, module.state)
})
```

开发环境下，假设当前模块名叫 'value'，如果它的父模块（假设模块名叫 foo）的 state 对象中也有 'value'，当你通过 store.state.foo.value 获取父模块 foo 的 state 的 value 值时，你拿到的却是当前 value 模块的配置对象。父模块的 state 的 value 属性被屏蔽了。

因此，如果模块名已存在于父模块的 state 对象中，会给出报错提示。接着：

`Vue.set(parentState, moduleName, module.state)`

Vue.set 给父模块的 state 对象添加响应式属性，属性名为当前模块名，属性值为模块的 state 对象。于是，读取父模块的 state 对象中的当前模块名，就能获得当前模块的 state 值。并且这些 state 属性是响应式的。

因为非根模块才能执行 if 语句块，所以根 state 对象会添加子 state 属性，如果子模块还嵌套子模块，installModule 时会把当前模块的 state 添加到父 state 中。

我们回头看看 _withCommit 这个 Store 的原型方法

```js
_withCommit (fn) {
  const committing = this._committing
  this._committing = true
  fn()
  this._committing = committing
}
```
_withCommit 接收函数 fn，把 store._committing 置为 true，然后执行 fn，再把 store._committing 恢复为原值，保证了 fn 执行过程中 store._committing 始终为 true。

为什么要这么做？

Vuex 把所有对 state 的修改操作都放在 _withCommit 的回调 fn 中进行，比如这里给父 state 对象添加响应式 state。保证过程中 store._committing 为 true，其他时刻都为 false。当用户在 mutation 之外非法修改 state，就便于报错提示。

接下来，生成一个包含本地化的方法和属性的，类似 store 对象那样的对象 local：

```js
const local = module.context = makeLocalContext(store, namespace, path)
```

执行 makeLocalContext 方法，传入 store 对象，当前模块的命名空间，当前 path，返回值赋给 local 和 module.context。

```js
function makeLocalContext (store, namespace, path) {
  const noNamespace = namespace === ''
  const local = {
    // dispatch:....
    // commit:....
  }
  Object.defineProperties(local, {
    getters: {
      // ...
    },
    state: {
      // ...
    }
  })
  return local
}
```

noNamespace 的真假，代表该模块是否开启了命名空间。然后创建对象 local，里面定义 dispatch、commit 方法和 getters 和 state 属性，最后 makeLocalContext 返回 local 对象。

我们先看 local.dispatch：

```js
const local = {
  dispatch: noNamespace ? store.dispatch : (_type, _payload, _options) => {
    const args = unifyObjectStyle(_type, _payload, _options)
    const { payload, options } = args
    let { type } = args
    if (!options || !options.root) {
      type = namespace + type
      if (process.env.NODE_ENV !== 'production' && !store._actions[type]) {
        console.error(`[vuex] unknown local action type: ${args.type}, global type: ${type}`)
        return
      }
    }
    return store.dispatch(type, payload)
  },
}
```

如果当前模块没有开启命名空间，则 local.dispatch 就取 store.dispatch。后面会仔细讲 store.dispatch。

如果当前模块开启了命名空间，则重新定义 local.dispatch 方法，它可以接收三个参数：
1. _type：即 action 的名称
2. _payload：载荷对象
3. _options：配置对象

参数会先传入 unifyObjectStyle 函数做归一化处理，返回值赋给 args：

```js
function unifyObjectStyle (type, payload, options) {
  if (isObject(type) && type.type) {
    options = payload
    payload = type
    type = type.type
  }
  if (process.env.NODE_ENV !== 'production') {
    assert(typeof type === 'string', `expects string as the type, but found ${typeof type}.`)
  }
  return { type, payload, options }
}
```

如果第一个参数传的是对象且有 type 属性，则将传入的第二个参数作为 options ，第一个参数作为 payload，type 则取第一个参数的 type 属性

开发环境下，如果 type 不是字符串，抛出错误。

最后返回出包含 type, payload, options 的对象，再从中解构出 type, payload, options 变量。

```js
dispatch: noNamespace ? store.dispatch : (_type, _payload, _options) => {
  const args = unifyObjectStyle(_type, _payload, _options)
  const { payload, options } = args
  let { type } = args
  if (!options || !options.root) {
    type = namespace + type
    if (process.env.NODE_ENV !== 'production' && !store._actions[type]) {
      console.error(`[vuex] unknown local action type: ${args.type}, global type: ${type}`)
      return
    }
  }
  return store.dispatch(type, payload)
},
```

如果 local.dispatch 没有接收到配置对象或没传 root:true，则给接收到的 type 字符串加上命名空间字符串作为前缀。

如果 local.dispatch 接收的配置对象中传了 root:true，则 type 不需做变动。

如果 store._actions 这个存放 action 的对象中没有 type 对应的值，说明 dispatch 的这个 action 还没注册，报错提示并直接返回。

最后调用 store.dispatch，传入的 type 是考虑了命名空间的 type。

再来看 local.commit。如果当前模块没有开启命名空间，则 local.commit 就是 store.commit，否则重新定义 local.commit：

```js
commit: noNamespace ? store.commit : (_type, _payload, _options) => {
  const args = unifyObjectStyle(_type, _payload, _options)
  const { payload, options } = args
  let { type } = args
  if (!options || !options.root) {
    type = namespace + type
    if (process.env.NODE_ENV !== 'production' && !store._mutations[type]) {
      console.error(`[vuex] unknown local mutation type: ${args.type}, global type: ${type}`)
      return
    }
  }
  store.commit(type, payload, options)
}
```

接收 mutation type、载荷对象、配置对象，传入 unifyObjectStyle 做归一化处理。再从返回值中解构出 type, payload, options 变量。

如果 local.commit 没有接收到配置对象或没传 root:true，则将 type 字符串加上命名空间字符串作为前缀，否则 type 字符串不做改动。

接着判断，如果 store._mutations 这个存放 mutation 的对象里，不存在 type 对应的值，报错提示，告诉用户提交的 mutation 不存在，直接返回。

最后调用并返回 store.commit，传入的是考虑了命名空间的 type。

```js
Object.defineProperties(local, {
  getters: {
    get: noNamespace
      ? () => store.getters
      : () => makeLocalGetters(store, namespace)
  },
  state: {
    get: () => getNestedState(store.state, path)
  }
})
return local
```

继续填充 local 对象，添加两个响应式属性：getters 和 state。

读取 local.getters 时，会触发它的 get 方法，如果当前模块没有开启命名空间，则直接返回 store.getters。如果开启了命名空间，返回 makeLocalGetters 的执行结果，传入的是 store 对象和当前的命名空间。

读取 local.state 时，会触发它的 get 方法，根据根 state 和当前 path，返回出当前模块的 state 对象。

local 的 state 和 getters 都是只读属性，不能直接修改属性值。

看看生成本地 getters 的 makeLocalGetters 函数：

```js
function makeLocalGetters (store, namespace) {
  if (!store._makeLocalGettersCache[namespace]) {
    const gettersProxy = {}
    const splitPos = namespace.length
    Object.keys(store.getters).forEach(type => {
      if (type.slice(0, splitPos) !== namespace) return
      const localType = type.slice(splitPos)
      Object.defineProperty(gettersProxy, localType, {
        get: () => store.getters[type],
        enumerable: true
      })
    })
    store._makeLocalGettersCache[namespace] = gettersProxy
  }
  return store._makeLocalGettersCache[namespace]
}
```
store._makeLocalGettersCache 对象专门缓存生成的本地 getters。

如果该缓存对象已经存在当前命名空间，则直接返回其缓存值，如果没有，则执行if语句块。

if语句块中，首先定义一个空对象 gettersProxy，然后获取命名空间字符串的长度。然后遍历 store.getters 对象，如果当前遍历的 type 字符串从开头 slice 一个空间字符串的长度，得到的字符串和命名空间字符串不相同，直接返回。继续遍历。

遇到相同的，则获取本地的 getter 名，即去掉前面的命名空间字符串，将它作为只读属性定义在 gettersProxy 对象上，属性值是 store.getters 中对应的 getter。

遍历完后，gettersProxy 对象就存放了该开启了命名空间的模块下的所有本地 getter 名，和它对应的 getter。

然后将 gettersProxy 赋给 store._makeLocalGettersCache[namespace]。

_makeLocalGettersCache 对象中，存放着不同的 namespace，对应着一个对象，存放该模块下的本地 getter 名和对应的 getter。

可见，makeLocalGetters 就是根据命名空间在全局 getters 对象中找出当前命名空间对应的模块的所有的 getter，返回一个 key 是本地 getter 名，val 是对应的 getter 的对象。

到此 local 对象填充完毕，它里面有：为当前模块设置的本地化的 dispatch、commit 方法，和 getter 和 state 属性

回到 installModule 函数，接着是对用户配置的 mutation 进行注册，调用 Module 的原型方法 forEachMutation，将回调函数传入执行

```js
module.forEachMutation((mutation, key) => {
  var namespacedType = namespace + key;
  registerMutation(store, namespacedType, mutation, local);
})
```
```js
forEachMutation (fn) {
  if (this._rawModule.mutations) {
    forEachValue(this._rawModule.mutations, fn)
  }
}
```
如果当前模块的配置对象传了 mutations，遍历该 mutations 对象执行 fn。

fn 首先将 type 名加上当前模块的 namespace 作为前缀。然后调用 registerMutation 注册。

```js
function registerMutation (store, type, handler, local) {
  const entry = store._mutations[type] || (store._mutations[type] = [])
  entry.push(function wrappedMutationHandler (payload) {
    handler.call(store, local.state, payload)
  })
}
```
结合`registerMutation(store, namespacedType, mutation, local);`来看

registerMutation 函数接收的这 4 个参数：

1. store：new Vuex.Store 创建的 store 实例
2. namespacedType：结合了命名空间字符串的全局 mutation 名
3. mutation：对应的处理函数。
4. local：一个包含为当前模块设置的局部化的 dispatch、commit 方法，和 getters、state 属性的对象

```js
function registerMutation (store, type, handler, local) {
  const entry = store._mutations[type] || (store._mutations[type] = [])
  entry.push(function wrappedMutationHandler (payload) {
    handler.call(store, local.state, payload)
  })
}
```

如果当前遍历的全局 mutation 名在 store._mutations 对象中没有对应的值，则将它添加进去，初始化为空数组，用来存放对应的用户配置的 handler。数组的引用赋给 entry。

接着往 entry 数组推入一个 handler 的封装函数，handler 执行时的 this 指向 store，这样用户在书写 handler 时可以通过 this 引用 store 的属性和方法。并且传入 handler 的是 local.state，这样用户在 handler 中通过局部的 state 名能获取到当前模块的 state 值。

遍历完当前模块的 mutations 对象后，store._mutations 对象中，每一个全局 mutation 名，都对应一个存放了包裹后的 mutation 函数的数组。这就是 mutation 的注册。

接着，是 action 的注册

```js
module.forEachAction((action, key) => {
  const type = action.root ? key : namespace + key
  const handler = action.handler || action
  registerAction(store, type, handler, local)
})
```
```js
forEachAction (fn) {
  if (this._rawModule.actions) {
    forEachValue(this._rawModule.actions, fn)
  }
}
```
如果当前模块的配置对象传了 actions，则遍历 actions 对象执行 fn。

在 fn 中，如果用户配置 action 时传了root: true，则 type 为本地的 action 名，如果配置了root:true，则 type 为命名空间字符串加上本地 action 名。

用户配置 action 时，可以传一个包含 handler 的对象，也可以直接传 handler 函数。

调用 registerAction 进行 action 的注册。

```js
function registerAction (store, type, handler, local) {
  const entry = store._actions[type] || (store._actions[type] = [])
  entry.push(function wrappedActionHandler (payload) {
    let res = handler.call(store, {
      dispatch: local.dispatch,
      commit: local.commit,
      getters: local.getters,
      state: local.state,
      rootGetters: store.getters,
      rootState: store.state
    }, payload)
    if (!isPromise(res)) {
      res = Promise.resolve(res)
    }
    if (store._devtoolHook) {
      // ...
    } else {
      return res
    }
  })
}
```
如果 store._actions 对象存放 action 名和对应的 handler，如果当前 action 名没有对应的值，则初始化为[]。向这个数组中推入用户传的 handler 函数的包装函数。

包装函数中，首先会调用 handler 函数，返回值赋给 res 缓存起来，执行时的 this 指向 store 对象，handler 函数接收一个和 store 实例具有相同方法的 context 对象，但不同在于：它的 state getters commit dispatch 是局部化的属性和方法。比如，调用 context.commit 模块中的 mutation 时，传入本地 type 即可，不用传全局 type，即便开启了命名空间。

如果 handler 不是返回 promise 实例，将它包裹为成功值为 res 的 promise 实例，这说明用户书写的 action handler 经过注册后，执行都会返回 promise 实例。

接着，对用户配置的 getter 进行注册

```js
module.forEachGetter((getter, key) => {
  const namespacedType = namespace + key
  registerGetter(store, namespacedType, getter, local)
})

forEachGetter (fn) {
  if (this._rawModule.getters) {
    forEachValue(this._rawModule.getters, fn)
  }
}
```
遍历用户给当前模块的配置对象传的 getters 对象，执行回调，在回调中，获取当前模块的命名空间和 getter 名拼接后的字符串，然后调用 registerGetter 注册 getter。

这么看来注册 getter 和 mutation 都是用的全局 type。注册 action，如果没有配置 root:true，也是使用全局 type，否则使用局部的 type。

```js
function registerGetter (store, type, rawGetter, local) {
  if (store._wrappedGetters[type]) {
    if (process.env.NODE_ENV !== 'production') {
      console.error(`[vuex] duplicate getter key: ${type}`)
    }
    return
  }
  store._wrappedGetters[type] = function wrappedGetter (store) {
    return rawGetter(local.state,local.getters,store.state,store.getters)
  }
}
```
注册 getter，如果当前全局 getter 名已经存在于 store._wrappedGetters 对象中，则报错提示：重复的 getter 名字。然后直接返回。如果不是，则往该对象中添加全局 getter 名和对应的封装后的 getter 函数。

注意到 registerGetter 函数接收了 local，它是为当前模块生成的包含局部化方法和属性的对象。rawGetter 执行传入的是 local.state, local.getters 和全局的 state、getters。local.state 返回的是当前模块下的 state。所以用户书写 getter 函数时，第一个参数拿到的是模块的局部 state，

到此 mutation action getter 都注册完了，来到了 installModule 的最后一步：子模块的安装：

```js
module.forEachChild((child, key) => {
  installModule(store, rootState, path.concat(key), child, hot)
})
forEachChild (fn) {
  forEachValue(this._children, fn)
}
```

遍历当前模块的 _children 数组中所有的子模块对象，递归调用 installModule，传入：store 对象，根state，子模块的 path，子模块对象本身，和 hot。子模块的 mutation、action、getter 也得到注册。


## Store原型方法commit和dispatch
### commit

更改 state 只能通过提交 mutation，mutation 和事件类似：每个 mutation 都有一个事件类型 type 和回调函数 handler，handler 是用户书写的，它接收 local.state 作为第一个参数。

commit 是 Store 的原型方法：

```js
commit (_type, _payload, _options) {
  const {type, payload, options} = unifyObjectStyle(_type, _payload, _options)
  const mutation = { type, payload }
  const entry = this._mutations[type]
  if (!entry) {
    if (process.env.NODE_ENV !== 'production') {
      console.error(`[vuex] unknown mutation type: ${type}`)
    }
    return
  }
  this._withCommit(() => {
    entry.forEach(function commitIterator (handler) {
      handler(payload)
    })
  })
  // ...
}
```
commit 可以接收 3 个参数：

1. _type：要提交的 mutation 的 type 字符串
2. _payload：载荷对象
3. _options：配置对象，比如可以传 root: true，它允许在命名空间模块里提交根的 mutation

我们分段来看看 commit 的代码：

```js
const {type, payload, options} = unifyObjectStyle(_type, _payload, _options)
const mutation = { type, payload }
```

首先，unifyObjectStyle 函数对参数做统一化处理。再解构出 type, payload, options 变量。

接着，创建一个包含 type 和 payload 的对象 mutation。

```js
const entry = this._mutations[type]
if (!entry) {
  if (process.env.NODE_ENV !== 'production') {
    console.error(`[vuex] unknown mutation type: ${type}`)
  }
  return
}
```

接着获取 store._mutations 对象中的 type 对应的数组，该数组存放的是该 type 名对应的 mutation 处理函数。

如果该数组不存在，说明该 mutation 没有注册过，所以无法提交该 mutation，在开发环境下打印警告：未知的 mutation type，直接返回

接下来，继续看：

```js
this._withCommit(() => {
  entry.forEach(function commitIterator (handler) {
    handler(payload)
  })
})
```

遍历 store._mutations[type] 数组，执行数组里的 handler，传入用户调用 commit 时传入的 payload。因为 handler 执行是在修改 state，所以要 _withCommit 的包裹保证 _committing 为 true

接下来:
```js
this._subscribers
      .slice()
      .forEach(sub => sub(mutation, this.state))
```
store._subscribers 数组存放的是订阅 mutation 的函数，commit 提交 mutation 时，要将 _subscribers 数组中所有的订阅函数逐个执行，传入{ type, payload }和根state。通常用于 Vuex 插件，通过 store.subscribe 注册订阅 mutation 函数，用于追踪 state 的变化。

mutation 中必须是同步函数，即 Vuex 希望全部的状态的改变都用同步方式实现。因为这样状态改变后，订阅函数执行马上就能追踪到一个新的状态，如果 mutation 中是异步改变状态，订阅函数执行时，异步操作还没执行，状态的改变变得不可追踪。

### dispatch

dispatch 也是 Store 的原型方法，它的作用是分发 action。action 类似于 mutation，不同的是 action 不可以直接更改状态，但可以提交 mutation，且可以包含异步操作。

dispatch 的代码比较长，分段看：

```js
dispatch (_type, _payload) {
  const {type, payload } = unifyObjectStyle(_type, _payload)
  const action = { type, payload }
  const entry = this._actions[type]
  if (!entry) {
    if (process.env.NODE_ENV !== 'production') {
      console.error(`[vuex] unknown action type: ${type}`)
    }
    return
  }
  // ....
}
```
unifyObjectStyle 先做参数做归一化。归一化后的 type, payload 放入一个对象 action

store._actions[type] 是存放 type 对应的 action 方法的数组。如果该数组不存在，说明该 type 的 action 还没注册，报警提示；未知的 action type，然后直接返回。

继续：

```js
try {
  this._actionSubscribers
    .slice()
    .filter(sub => sub.before)
    .forEach(sub => sub.before(action, this.state))
} catch (e) {
  if (process.env.NODE_ENV !== 'production') {
    console.warn(`[vuex] error in before action subscribers: `)
    console.error(e)
  }
}
```
遍历 store._actionSubscribers 数组，过滤出存在 before 方法的项，再将所有 before 方法遍历执行。try catch 语句捕获这个过程中的错误。

再接下来：

```js
const result = entry.length > 1
  ? Promise.all(entry.map(handler => handler(payload)))
  : entry[0](payload)

return result.then(res => {
  // ...
  return res
})
```
如果 type 对应的 action handler 不止一个，可能每个都用 promise 管控了异步操作。如果我们只是遍历依次执行这些处理函数：entry.map(handler => handler(payload))。返回的数组赋给 result，由于这是同步代码，所以 result 数组里的 promise 的状态还是 pending，等到异步有了结果，result 数组里的 promise 才会改变状态。

`Promise.all(entry.map(handler => handler(payload)))`返回一个 promise 实例，map 返回的数组里所有 promise 都成功或数组里不包含 promise 时，这个 promise 才会成功，如果其中有一个失败了，则该 promise 失败，失败的原因是第一个失败 promise 的原因

Promise.all 返回的 promise 实例赋给 result，起初是 pending 状态，等所有 promise 都有结果了，则 result 也有结果了。

如果 type 的 action handler 只有一个，则执行它，传入 payload，返回值赋给 result。

已知经过注册，action handler 被包裹成一个必定返回 promise 的函数，所以 entry[0](payload) 必返回 promise 实例。因此 result 必定是 promise 实例。

```js
return result.then(res => {
  try {
    this._actionSubscribers
      .filter(sub => sub.after)
      .forEach(sub => sub.after(action, this.state))
  } catch (e) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn(`[vuex] error in after action subscribers: `)
      console.error(e)
    }
  }
  return res
})
```

异步有了结果，promise 成功的话，执行 then 的成功回调，在成功回调中，遍历 store._actionSubscribers 数组，过滤出带有 after 方法的项，遍历执行所有 after 方法，最后返回出 res。

store.dispatch 最后返回 then 返回的 promise。用户可以用它继续 then，并在成功回调中拿到 res。

```js
store.dispatch('actionA').then((res) => {
  // ....
})
```
res 是 actionA 函数返回的 promise 里的成功值，如果 handler 有多个，则它是数组。如果只有一个，则它是单个值。

## resetStoreVM

现在来到实例化 Store 构造函数的核心三件事的最后一件：响应式化 state

```js
resetStoreVM(this, state)
```
为什么要响应变化，因为在各个 Vue 实例里用到 store 的 state 的话，希望每当状态发生变化时，相应的组件会得到更新

传入 resetStoreVM 的 this 是 store 对象，state 是根state，我们看看 resetStoreVM：

```js
function resetStoreVM (store, state, hot) {
  const oldVm = store._vm
  store.getters = {}
  store._makeLocalGettersCache = Object.create(null)
  const wrappedGetters = store._wrappedGetters
  const computed = {}
  forEachValue(wrappedGetters, (fn, key) => {
    computed[key] = partial(fn, store)
    Object.defineProperty(store.getters, key, {
      get: () => store._vm[key],
      enumerable: true
    })
  })
  // ...
}
```

首先将 store._vm 赋给 oldVm，缓存一下旧的 vm 实例。

然后，给 store 对象上添加 getters 属性和 _makeLocalGettersCache 属性，值均为一个空对象。

store._wrappedGetters 对象存放已注册的 getter 方法。再定义一个 computed 空对象。遍历已注册的 getter 方法，往 computed 对象添加同名方法，方法值为 partial(fn, store)。

```js
function partial (fn, arg) {
  return () => {
    return fn(arg)
  }
}
```

传入 partial 的是已注册的 getter 方法和 store 对象，返回一个新的函数，新函数实际执行 getter 方法，getter 执行接收 store 对象。

为什么不直接给 computed 对象添加 getter。因为为了 getter 在外部调用时，也能引用 partial 函数作用域中的 store 这个私有形参，形成了闭包，而 partial 的 store 也通过闭包引用了 resetStoreVM 的私有形参 store，所以 store 不会随着 resetStoreVM 函数执行结束而销毁。否则 resetStoreVM 执行后，store 就不再驻留在内存中了，getter 方法中引用不到 store 对象。

接着往 store.getters 这个空对象添加只读属性，属性名是 getter 名，读取返回 store._vm[key]

```js
Object.defineProperty(store.getters, key, {
  get: () => store._vm[key],
  enumerable: true
})
```

问题来了，store._vm 是怎么来的，上面怎么会有 getter 的同名属性？接着看 resetStoreVM 函数：

```js
const silent = Vue.config.silent
Vue.config.silent = true
store._vm = new Vue({
  data: {
    $$state: state
  },
  computed
})
Vue.config.silent = silent
```
首先缓存 Vue.config.silent 的值。然后将 Vue.config.silent 置为 true，创建 Vue 实例完后将它恢复为原来的值，保证了这期间 Vue 不会打印日志与警告。因为借用 Vue 创建实例的过程可能会存在一些不严格的模式，但不希望因此报错。

实例化 Vue 时，$$state 会转成响应式属性，它的属性值：根state 会被深度观测，内部属性也响应式化。

我们知道，安装了 Vuex 后，之后创建的所有 vm 实例能引用到 store 对象。读取 vm.$store.state，即读取 store.state，而 Store 构造函数有 state 原型属性：
，
```js
get state () {
  return this._vm._data.$$state
}
```

返回的是 store._vm._data.$$state。我们知道，Vue 把 data 数据挂载到 vm 实例的 _data 上，所以 store._vm._data 访问到的是定义的 data 对象，store._vm._data.$$state 访问的是 data 中的 $$state，即根state。

这样就实现了在vm实例中，通过 vm.$store.state 访问根 state 对象，并且 state 对象内部的属性是响应式的。

```js
store._vm = new Vue({
  // ...
  computed
})
```
并且，computed 对象作为 computed 选项传入 new Vue，里面存放的 getter 方法被注册为计算属性。

举个例子，在某个 vm 实例中访问 vm.$store.getters.xxx，即访问 store.getters.xxx。前面讲过，Vuex 已经向 store.getters 对象添加了响应式只读属性 xxx，因此会触发 get 方法，返回 store._vm.xxx

```js
Object.defineProperty(store.getters, key, {
  get: () => store._vm[key],
  enumerable: true
})
```

xxx 这个 getter 名已经被注册为 store._vm 的计算属性了，所以 store._vm.xxx 可以访问到 xxx 的 getter 方法。

继续看 resetStoreVM：

```js
if (store.strict) {
  enableStrictMode(store)
}
```
如果是严格模式，调用 enableStrictMode 函数，传入 store

```js
function enableStrictMode (store) {
  store._vm.$watch(function () { return this._data.$$state }, () => {
    if (process.env.NODE_ENV !== 'production') {
      assert(store._committing, `do not mutate vuex store state outside mutation handlers.`)
    }
  }, { deep: true, sync: true })
}
```
由 Vue 源码可知，$watch 执行会执行 `function () { return this._data.$$state }` 函数，从而收集创建出来的 watcher，watcher 监听了 `store._vm._data.$$state` 这个数据属性，配置对象是 `{ deep: true, sync: true }` 意味着 $$state 属性值(根state)会被深度观测，当 state 发生变化时，watcher 的 update 方法执行，会重新求值，并执行 $watch 的回调函数。

在该回调函数中，如果当前 store._committing 为 false，则会抛错。因为 mutation 执行期间之外 _committing 都是false，说明 state 在 mutation 函数以外被修改。所以 enableStrictMode 函数为 state 设置了一个监听，在它被修改时执行回调，给用户提示。

接着：

```js
if (oldVm) {
  if (hot) {
    store._withCommit(() => {
      oldVm._data.$$state = null
    })
  }
  Vue.nextTick(() => oldVm.$destroy())
}
```
如果之前就创建过 store.vm，现在 resetStoreVM 要创建新的 vm 和 watcher，要销毁旧的 vm 实例，但不希望在同步代码中销毁，会阻塞代码的执行，所以调用 nextTick 方法将销毁的操作放到异步队列中。销毁旧的 vm 实例意味着会将创建的 watcher 销毁，不再监听 state 

resetStoreVM 函数就看完了。



## 辅助函数的实现

### mapState

当你想在一个组件中使用 state 数据 xxx 时，你可以通过 this.$store.state.xxx，但每次都这样读取很麻烦，你可以将它声明为当前组件的一个计算属性。

当一个组件需要使用到多个 state 时，逐一声明为计算属性也繁琐。可以使用 mapState 辅助函数帮助我们生成计算属性：
```js
var mapState = normalizeNamespace(function (namespace, states) {
  var res = {};
  normalizeMap(states).forEach(function (ref) {
    // ...
  });
  return res
});
```

mapState 是 normalizeNamespace 函数的返回值。

```js
function normalizeNamespace (fn) {
  return function (namespace, map) {
    if (typeof namespace !== 'string') {
      map = namespace;
      namespace = '';
    } else if (namespace.charAt(namespace.length - 1) !== '/') {
      namespace += '/';
    }
    return fn(namespace, map)
  }
}
```
normalizeNamespace 接收函数 fn，返回出新的函数，因此 mapState 指向该新函数。如果第一个参数接收的不是字符串，就把它作为 map，namespace 赋值为''。如果是字符串，但最后一个字符不是 "/" ，会给 namespace 末尾加上 "/"。

处理完返回 namespace 字符串后，执行并返回 fn(namespace, map)，即 mapState 实际执行 fn。我们具体看看传入的 fn：
```js
var mapState = normalizeNamespace(function (namespace, states) {
  var res = {};
  normalizeMap(states).forEach(function (ref) {
    // ...
  });
  return res
});
```

可见 fn 执行返回 res 对象，中间的语句肯定是填充 res 对象，normalizeMap(states) 返回了什么内容？

```js
function normalizeMap (map) {
  return Array.isArray(map)
    ? map.map(key => ({ key, val: key }))
    : Object.keys(map).map(key => ({ key, val: map[key] }))
}
```
normalizeMap(states) 的 states 就是用户调用 mapState 传入的对象。normalizeMap 首先判断该 states 是否为数组，如果是，将数组每项 key (字符串) 转成 { key:key, val:key } 这样的对象。例子是 mapState(['count', 'hhah'])

如果不是数组，则默认用户传的是对象，获取对象中的所有自有属性组成的数组，同样地，将每一项 key (字符串) 转成 { key: key, val: map[key] }

normalizeMap 就是针对用户不同形式的传参，做参数的归一化处理。返回的数组会进行 forEach 遍历：

```js
normalizeMap(states).forEach(function (ref) {
  var key = ref.key;
  var val = ref.val;
  res[key] = function mappedState () {
    var state = this.$store.state;
    var getters = this.$store.getters;
    if (namespace) {
      var module = getModuleByNamespace(this.$store, 'mapState', namespace);
      if (!module) return
      state = module.context.state;
      getters = module.context.getters;
    }
    return typeof val === 'function'
      ? val.call(this, state, getters)
      : state[val]
  };
  // mark vuex getter for devtools
  res[key].vuex = true;
});
```

回调函数中，ref 拿到当前遍历的对象，key 拿到对象中的 key 值，val 拿到对象中的 val 值。遍历的过程就是给空对象 res 添加方法，方法名为 key，方法为 mappedState 函数。

mappedState 函数首先获取到全局 state 和 getters。前面提过，如果用户没有给 mapState 传字符串，则 namespace 是''，否则它不为''，调用 getModuleByNamespace 获取到命名空间对应的 module 对象。

```js
function getModuleByNamespace (store, helper, namespace) {
  var module = store._modulesNamespaceMap[namespace];
  if (!module) {
    console.error(("[vuex] module namespace not found in " + helper + "(): " + namespace));
  }
  return module
}
```

前面讲过，执行 installModule 函数时，已经把所有的 namespace 和对应的模块添加进 store._modulesNamespaceMap 对象。

在这里先在 store._modulesNamespaceMap 对象找出 namespace 对应的 module。如果没找到，则报错提示。如果找到了，就把它返回。

```js
normalizeMap(states).forEach(function (ref) {
  // ...
  res[key] = function mappedState () {
    // ...
    if (namespace) {
      var module = getModuleByNamespace(this.$store, 'mapState', namespace);
      if (!module) return
      state = module.context.state;
      getters = module.context.getters;
    }
    return typeof val === 'function'
      ? val.call(this, state, getters)
      : state[val]
  };
  // ...
});
```
获取命名空间对应的 module 后，如果没获取到就直接返回，因为用户 mapState 传的字符串，不一定对应有模块对象。

然后，把当前模块的 state 对象赋给 state，

于是 state 拿到本地的（带命名空间的）的 state，getters 拿到本地的（带命名空间的）的 getters

mappedState 函数最后返回：

```js
return typeof val === 'function' 
      ? val.call(this, state, getters)
      : state[val]
```

val 是什么？它是 normalizeMap(states) 数组中当前遍历对象的 val 值，如果它是函数，则默认用户调用 mapState 传的第二个参数是一个对象，而且属性值是函数，那么直接调用 val 这个函数，执行时 this 指向当前 Vue 实例，因为 mapState 调用的环境中，this 指向 当前 Vue 实例。val 执行传入 state，getters。

如果 val 不是函数，则默认用户调用 mapState 传的第二个参数是由字符串组成的数组，返回 state[val]，即通过本地的 key 字符串获取到 state 对象中对应的 state。

综上，我们了解了 mapState 函数接收参数的形式：第一个参数可以接收模块的空间命名字符串，也可以不传，第二个参数是一个 map 对象，可以传数组或对象。

mapState 会返回一个对象 res，里面存放的属性名是用户在 map 对象中起的字符串，属性值一个 mappedState 函数，函数执行返回 state 对象中对应 state 值

因此，你可以这么使用mapState

比如
```js
 computed: mapState({
    count: state => state.count,
    countAlias: 'count',
    // 传字符串参数 'count' 等同于 `state => state.count`    
    countPlusLocalState (state) {
      return state.count + this.localCount
    }
    // 为了能够使用 `this` 获取局部状态，必须使用常规函数
  })
```
mapState 传入的这个对象，就是 map 对象，它会经过 normalizeMap 处理，转成数组，每个元素是一个对象{ key, val }，然后遍历这个数组，往待返回的对象 res 里添加方法，方法名为 key，如果 val 是函数，就直接返回 val 的执行结果，如果不是，就返回 state 中 val 的值，比如上面的 countAlias: 'count'

mapState 返回的对象，作为 computed 选项，那么 count，countAlias，countPlusLocalState 都被初始化为计算属性

用户给 mapState 传入的 map 还可以是数组，比如这么写：

```js
computed: mapState([
  'count',// 映射 this.count 为 store.state.count
  'xxxxx'
])
```
mapState 会将数组的每项转成 {'count': 'count'} 这样的形式，遍历数组，往 res 对象里添加方法，方法名为 'count'，方法本身执行返回 store.state.count

mapState 返回的是对象，我们可以用对象展开运算符，将里面的键值对直接混入到 computed 的配置对象中，这样就不影响用户写别的自定义计算属性：
```js
computed: {
  localComputed () { /* ... */ },
  ...mapState({
    // ...
  })
}
```
那带命名空间的模块里的state呢，怎么通过mapState获取，可以这么写
```js
computed: {
  ...mapState({
    a: state => state.some.nested.module.a,
    b: state => state.some.nested.module.b
  })
},
```
"a" 和 "b" 是用户起的计算属性名，属性值是返回对应 state 数据的函数，这样就能绑定带命名空间的模块，但这么写明显比较繁琐。

用户 mapState 时第一个参数可以传模块的空间命名字符串，这样所有的绑定会自动将该模块作为上下文。

```js
computed: {
  ...mapState('some/nested/module', {
    a: state => state.a,
    b: state => state.b
  })
},
```
由前面的源码我们知道，mapState 会根据 namespace 获取对应的模块 module，然后函数中的 state 就不再指向根 state，被覆盖为 module.context.state，即对应模块的 state，剩下的逻辑和前面一样，第二个参数 map 对象中的函数的 state 就不是根 state了，而是当地化的 state。

是不是终于搞懂了 mapState 的内部实现？

### mapGetters
和 mapState 的实现很像。
```js
var mapGetters = normalizeNamespace((namespace, getters) => {
  const res = {}
  normalizeMap(getters).forEach(({ key, val }) => {
    val = namespace + val
    res[key] = function mappedGetter () {
      if (namespace && !getModuleByNamespace(this.$store, 'mapGetters', namespace)) {
        return
      }
      if (process.env.NODE_ENV !== 'production' && !(val in this.$store.getters)) {
        console.error(`[vuex] unknown getter: ${val}`)
        return
      }
      return this.$store.getters[val]
    }
    res[key].vuex = true
  })
  return res
})
```
我们这直接讲了，不分段了。mapGetters 接收 namespace（可选）和 getters（一个map对象），mapGetters 指向 normalizeNamespace 执行返回的函数，mapGetters 执行实际执行传入 normalizeNamespace 的回调函数。

用户传的 map 对象有两种形式：

1. ['getter1', 'getter2']   数组项就是 store 里 getter 的实际名称
2. { myGetter1: 'getter1'}  你想将 getter 起另外的名称，就这样使用对象去定义

在这个回调函数中，首先定义一个待返回的对象 res，将传入的 map 对象经过 normalizeMap 处理成数组，对应上面的例子分别是：

1. [{'getter1':'getter1'}, {'getter2':'getter2'}]
1. [{'myGetter1':'getter1'}]

调用 forEach 函数进行遍历，key 取到数组当前遍历对象里的 key，val 取它的 val，如果存在命名空间的话，val 字符串前面还要拼上命名空间字符串

往 res 对象中添加键值对，属性值为 key，属性值为 mappedGetter 函数，函数执行返回 store 里的 getters 中 val 对应的 getter，最后 mapGetters 执行返回出这个 res 对象

所以 ...mapGetter(...) 可以直接放在 computed 选项的配置对象中，被注册为计算属性，处理函数返回值是 store.getters 对应的属性值

### mapActions
```js
  var mapActions = normalizeNamespace((namespace, actions) => {
    const res = {}
    normalizeMap(actions).forEach(({ key, val }) => {
      res[key] = function mappedAction (...args) {
        // get dispatch function from store
        let dispatch = this.$store.dispatch
        if (namespace) {
          const module = getModuleByNamespace(this.$store, 'mapActions', namespace)
          if (!module) return
          dispatch = module.context.dispatch
        }
        return typeof val === 'function'
          ? val.apply(this, [dispatch].concat(args))
          : dispatch.apply(this.$store, [val].concat(args))
      }
    })
    return res
  })
```

和前面俩一样，mapActions 执行实际执行传入 normalizeNamespace 的回调。

在回调函数中，准备一个空对象 res。

normalizeMap 会将 mapActions 接收的 action 对象格式化成一个数组，每一项都是一个类似这样的对象：{ key: key, val: val }，遍历数组，往 res 对象中添加键值对：action 名和它对应的 mappedAction 函数。res 对象经过展开后可以注册在 methods 选项对象中，所以这个 mappedAction 函数就是一个 method。

args 是 mappedAction 函数所接收的参数数组，这个函数中，首先用 dispatch 变量缓存 this.$store.dispatch 的方法，如果 namespace 存在，说明 mapActions 时传入的第一个参数是带命名空间的字符串，根据 namespace 获取对应的模块，获取不到就直接返回，然后把 dispatch 变量覆盖为所找到的模块对应的 dispatch 方法，这是 local 的本地化的 dispatch。

最后判断 val 是否是函数，即用户传入的 map 对象的 val 是否是函数，是则直接调用，this 指向当前 Vue 实例。

如果不是一个函数，则调用 dispatch 方法，this 指向 store 对象，传入 action 的实际名称，即 val，和作为 method 接收的参数 args。比如，用户会这么写：
```js
methods:{
  ...mapActions(['action1', 'action2']),

  ...mapActions({
    myAction3: 'action3'
  }),
}
```
第一个mapActions执行返回的对象大致是：{ 'action1': 函数1, 'action2': 函数2 }

这个对象被展开后，混入 methods 配置对象中，那么函数 1 作为 method，它接收的参数组成了数组 args

函数 1 主要是调用 dispatch.apply(this.$store, [val].concat(args))，即 this.$store.dispatch('action1', ...args)

就像下面这样：

```js
methods：{
  action1(...args){
    // ...
    return this.$store.dispatch('action1', ...args)
  }
}
```
第二个 mapActions 执行返回的对象，会像这样：{ 'myAction3' : 函数3 }

这个对象被展开后混入 methods 配置对象中，它接收的参数组成了数组 args。

```js
methods：{
  myAction3(...args){
    // ...
    return this.$store.dispatch('action3', ...args)
  }
}
```

所以函数 3 主要就是调用并返回 this.$store.dispatch('action3', ...args)

### mapMutations

```js
var mapMutations = normalizeNamespace((namespace, mutations) => {
    const res = {}
    normalizeMap(mutations).forEach(({ key, val }) => {
      res[key] = function mappedMutation (...args) {
        let commit = this.$store.commit
        if (namespace) {
          const module = getModuleByNamespace(this.$store, 'mapMutations', namespace)
          if (!module) return
          commit = module.context.commit
        }
        return typeof val === 'function'
          ? val.apply(this, [commit].concat(args))
          : commit.apply(this.$store, [val].concat(args))
      }
    })
    return res
  })
```
同样的，mapMutations 执行相当于执行 (namespace, mutations) => {....} 这个回调，返回出对象 res。

用户可以这么使用：

```js
methods: {
  ...mapMutations(['muta1',  'muta2' ]),
  ...mapMutations({ myMuta3: 'muta3' })
}
```
比如第一个，返回的 res 对象就像这样: { 'muta1': 函数1 ,  'muta2': 函数2  }

将这个对象展开放入 methods 配置对象中，'muta1' 就成了 method 名，method 值为函数1，函数 1 接收的参数数组为 args

函数1 就是源码中的 mappedMutation 函数，它首先获取 this.$store.commit，如果用户在 mapMutation 时第一个参数传了模块命名空间字符串，就获取模块本地化的 commit，然后 执行 commit.apply(this.$store, [val].concat(args))，也就是 `this.$store.commit('muta1', ...args)`

第二个也类似，相当于注册这样的 method：

```js
methods:{
  myMuta3(...args){
    // ...
    return this.$store.commit('muta3' , ...args)
  }
}
```

现在好像 Vuex源码基本分析完了。。
