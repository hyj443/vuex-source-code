# 逐行解析Vuex源码

## 回顾一下Vuex是什么

Vuex 是一个专为Vue框架设计的，进行状态管理的库，将共享的数据抽离，放到全局形成一个单一的store，同时利用了Vue内部的响应式机制来进行状态的管理和更新。
![vuex组成](https://vuex.vuejs.org/vuex.png)
Vuex，在全局有一个state存放数据，所有修改state的操作必须通过mutation进行，mutation的同时，提供了订阅者模式供外部插件调用，获取state数据的更新。
所有异步操作都走action，比如调用后端接口异步获取数据，action同样不能直接修改state，要通过若干个mutation来修改state，所以Vuex中数据流是单向的。
state的变化是响应式的，因为Vuex依赖Vue的数据双向绑定，需要new一个Vue对象来实现响应式化。

看源码之前再看一遍[Vuex文档](https://vuex.vuejs.org/zh/)会加深理解，建议抽空过一遍。

## Vuex的安装

Vuex 文档告诉我们：

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

Vuex 的入口文件 src\index.js 中，默认导出的对象是这样的：

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
提供了 install 方法。Vue.use 执行，会调用插件的 install 方法，传入 Vue 构造函数。看看 install 方法：

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

首次调用 install 的话，本地 Vue 还未定义，传入的 Vue 构造函数赋给了 Vue，调用 applyMixin 进行真正的安装。

如果再次调用 install，Vue 已经有值且和传入的 Vue 相同，在开发环境下会打印警告：Vuex 已经安装过了，Vue.use(Vuex) 只用调用一次。然后直接返回，避免插件的重复安装。

接着执行 applyMixin 函数：

```js
export default function (Vue) {
  const version = Number(Vue.version.split('.')[0])
  if (version >= 2) {
    Vue.mixin({ beforeCreate: vuexInit })
  } else {
    // Vue 1.x 的处理，不做分析
  }
  function vuexInit () {
    //
  }
}
``` 

如果 Vue 的版本是 2.x，调用 Vue.mixin，混入一个 beforeCreate 钩子：vuexInit。

Vue.mixin 混入了钩子后，之后创建的每个vm实例，执行到 beforeCreate 钩子时，都会调用 vuexInit，且它的 this 指向当前的vm实例。

看看 vuexInit：

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

vuexInit 钩子函数，首先获取当前 Vue 实例的 $options 对象。如果 $options.store 存在，说明实例化 Vue 时传了 store。只有在创建根 Vue 实例时，才会传入 store 对象：

```js
new Vue({
  store,
  router,
  render: h => h(App)
}).$mount('#app')
```

所以当前 Vue 实例是根实例，于是给根实例添加 $store 属性，值为 options.store() 或 options.store，取决于传入的 store 是否为函数。

如果当前不是根 Vue 实例，但它有父实例且父实例的 $store 有值，那么也给当前实例添加 $store 属性，属性值取父实例的 $store 值。

因为每个vm实例的生命周期都会执行 vuexInit 钩子，根实例和子实例，都添加了 $store 属性，属性值指向同一个 store 对象，即 new Vue 时传的 store 对象。因此在任意组件中都可以通过 this.$store 访问到它。

## store 对象的创建

可见，根实例注册的 store 对象会通过 applyMixin 向下注入到各个组件实例中。那这个 store 对象是怎么来的？

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

我们拆分成几段来看 Store 这个构造函数：

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

如果本地 Vue 没有值，且处在浏览器环境，且 window.Vue 存在，则传入 window.Vue 执行 install。这意味着，如果使用 `<script>` 标签引用 Vuex 的方式，不需要用户手动调用 Vue.use(Vuex)，Vuex 能主动调用 install 安装。

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
this._committing = false // 提交mutation状态的标志
this._actions = Object.create(null) // 存放actions
this._actionSubscribers = [] // action 订阅函数集合
this._mutations = Object.create(null) // 存放mutations
this._wrappedGetters = Object.create(null) // 存放getters
this._modules = new ModuleCollection(options) // module收集器
this._modulesNamespaceMap = Object.create(null) // 模块命名空间
this._subscribers = [] // 存储所有对mutation变化的订阅者
this._watcherVM = new Vue() // Vue实例
this._makeLocalGettersCache = Object.create(null)//存放生成的本地getters的缓存
// ...
this.strict = strict
```

我们暂时不用了解每一个实例属性的具体含义。但其中的重点是：

 `this._modules = new ModuleCollection(options)`
 
创建 ModuleCollection 的实例赋给了 Store 实例属性 _modules，稍后会详细介绍，继续看 Store：

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

首先 store 变量保存当前 store 实例。然后变量 dispatch 和 commit，分别缓存 Store 原型上的 dispatch 和 commit 方法，稍后具体讲。

接着，给 store 实例添加 dispatch 和 commit 方法，它们分别实际调用原型上的 dispatch 和 commit 方法，执行时的 this 指向当前 store 实例。

因此 store 实例能调用 commit 和 dispatch 方法。

接着看 Store 构造函数：

```js
this.strict = strict
const state = this._modules.root.state
installModule(this, state, [], this._modules.root)
resetStoreVM(this, state)
plugins.forEach(plugin => plugin(this))
```
从 options 中解构出来的 strict 属性值，赋给 store 实例的 strict。

前面提到，this._modules 是 ModuleCollection 的实例，我们稍后会讲到它的 root 属性值是根 module 对象，根 module 对象的 state 属性指向它的 state 对象，即根 state。

调用 installModule 进行模块的注册，传入 store 实例、根 state、[]、根 module 对象。

调用 resetStoreVM 函数，对 state 进行响应式化处理

遍历 plugins 数组，逐个注册 Vuex 自己的插件

到目前为止，Store 构造函数已经过了一遍。new Store 主要做了三件事：

1. 初始化一些内部属性，其中重点是 this._modules = new ModuleCollection(options)
2. 执行 installModule，安装模块
3. 执行 resetStoreVM，使store响应式化

我们将逐个细说这三个，我们先看实例化 Store 时配置对象该传什么：

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
在 register 函数中，如果在生产环境下，会调用 assertRawModule 函数，传入当前 module 的路径和配置对象。

assertRawModule 函数其实是对传入的配置对象做规范化校验：

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
首先会获取 assertTypes 的自有属性组成的数组，我们看看 assertTypes 包含哪些属性：

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
遍历该数组，执行回调，首先如果当前配置对象中不存在当前遍历的属性，直接返回。比如配置对象中没有传 actions，则不用对它校验。
 
否则，获取 assertTypes 对象中 key 对应的值，赋给 assertOptions，比如 'getters' 的属性值就是 functionAssert 对象

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

这表明，用户传的 getters 和 mutations 对象中的属性值需要传函数，否则会抛错。

当 key 为 'actions'，则 assertOptions.assert 函数就是：

```js
value => typeof value === 'function' ||
    (typeof value === 'object' && typeof value.handler === 'function')
```

这表明，用户传的 actions 对象中的属性值可以是函数，可以是包含 handler 函数的对象，否则就会抛错。

所以 assertRawModule 函数校验用来户传入的配置项 getters、mutations、actions 对象，如果没有按要求传就会抛错，并提示开发者。

## Module 收集

Vuex文档里是这么说：

> store 使用单一的状态树，用一个对象包含了全部的应用层级的状态，每个应用将仅仅包含一个 store 实例。

如果应用变得很复杂，store 对象就可能很臃肿。为了解决这个问题，Vuex 允许我们将 store 分割成模块，每个模块都有自己的 state 、mutation、action、getter、甚至是嵌套子模块，像下面这样从上至下进行同样方式的分割：

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

上面是使用 module 的写法，如果把 store 本身看作是根 module，它有嵌套的子 module，形成一种用配置对象描述的树形结构。

我们看看 new ModuleCollection 是如何实现 module 的收集的。

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
register方法接收的 3 个参数：

1. path：模块路径，是模块配置对象的属性名组成的数组，是模块的唯一标识。像刚刚的例子，根模块的 path 为 []，它的子模块 moduleA 的 path 是 ['a']，子模块 moduleB 的 path 是 ['b']，如果它们各自还有子模块，则它们的 path 就大致形如 ['a','a1']、['b','b1']
2. rawModule：当前模块的配置对象。rawRootModule 就是实例化 Store 时传入的配置对象。我们把创建的 store 对象看作是根 module，它的配置对象看作根 module 的配置对象。
3. runtime 表示是否是一个运行时创建的 module，默认为 true。

```js
this.register([], rawRootModule, false)
```
new ModuleCollection(options) 调用 register，第一个参数传 []，说明注册的是根 module。rawRootModule 是实例化 Store 时传入的配置对象。

我们具体分段看 register 的内部：

```js
if (process.env.NODE_ENV !== 'production') { // 对配置对象作一些判断
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

根据当前的配置对象 rawModule，创建一个 Module 实例，赋给变量 newModule。后面会详谈 Module 构造函数。

如果 path 是空数组，说明当前注册的是根 module，则把刚刚创建的 Module 实例赋给当前 ModuleCollection 的实例的 root 属性，即 root 属性保存了根 module 对象。

如果 path 不是空数组，则注册的是子 module，稍后会讲解。接着：

```js
if (rawModule.modules) {
  forEachValue(rawModule.modules, (rawChildModule, key) => {
    this.register(path.concat(key), rawChildModule, runtime)
  })
}
```
如果当前配置对象传了 modules，即配置了子模块，则遍历 modules 对象里的每个子模块的 key 名，递归调用 register，此时传入的 path 是 path.concat(key)，path 是当前注册的模块的路径，concat 上当前遍历的 key，就是子模块的路径。

比如模块 a 嵌套了模块 b，模块 b 嵌套了模块 c，那模块 c 的 path 是：['a','b'].concat('c')，即['a','b','c']

第二个参数 rawChildModule，是子模块的配置对象。

我们现在捋一捋：实例化 Store 会实例化 MoudleCollection，会调用 register 进行根 module 的注册，如果根配置对象配置了嵌套的子模块，则会继续调用 register 注册子 module。子模块的 path 不是空数组，执行刚刚那个 else 语句块:

```js
if (path.length === 0) {
  this.root = newModule
} else {
  const parent = this.get(path.slice(0, -1))
  parent.addChild(path[path.length - 1], newModule)
}
```

此时 path 是当前注册的子模块的路径，path.slice(0, -1) 是去掉最后一项的数组，即父模块的 path。将它传入 get 方法执行，是为了获取该当前子模块的父 module 对象，我们看看 get 这个 ModuleCollection 的原型方法：

```js
get (path) {
  return path.reduce((module, key) => {
    return module.getChild(key)
  }, this.root)
}
```

reduce 的详细用法可以参考 [reduce - MDN](https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Reference/Global_Objects/Array/Reduce)

我们先看一下 getChild 和 addChild 这两个 Module 的原型方法，再回来理解 get。

```js
getChild (key) {
  return this._children[key]
}
addChild (key, module) {
  this._children[key] = module
}
```

getChild 方法返回的是 this._children[key]，即通过 key 获取到当前 module 的子 module 对象，我们讲 Module 构造函数时会讲 _children 属性。

addChild 方法是给当前 module 对象的 _children，添加 key 和对应的子模块对象。

回到 ModuleCollection 的原型方法 get：

```js
get (path) {
  return path.reduce((module, key) => {
    return module.getChild(key)
  }, this.root)
}
```
为了方便理解，假设传入 get 的 path 为 ['a','b','c']

reduce 累加器的初始值为 this.root，是根 module，第一次迭代中，执行回调返回 key 为 'a' 的子 module，并且该子 module 会作为下一次迭代的累加器的值，即传给回调的第一个参数 module，第二次迭代执行返回 'a' 模块的下的 'b' 子模块对象，以此类推，最后 get 方法返回 ['a','b','c'] 对应的模块。

所以 get 方法是根据 path 返回出 path 对应的 module 对象。

```js
 const parent = this.get(path.slice(0, -1))
 parent.addChild(path[path.length - 1], newModule)
```
path[path.length - 1]，path 数组的最后一项，即当前模块的 key 名，newModule 是当前模块对象，它们被添加到父模块对象的 _children 对象中。

可见 module 的 _children 属性，建立起父子模块对象之间的联系。未加工的配置对象形成的树形结构，转成了一个个散落的父子 module 对象。

概况来说，new ModuleCollection(即 register 的执行)，做了两件事：

1. 根据 rawModule 配置对象通过 new Module 创建 module 对象
2. 通过递归调用 register，建立父子 module 对象之间的父子关系

new Module 是在 new ModuleCollection 的过程中发生的，先生成 module 对象，再进行 module 对象父子关系的收集。

提一下，module 对象或模块对象，都指的是 Module 实例。我们看看 Module 构造函数

## Module 构造函数

用户定义一个模块的配置对象是未经加工的，传入 new Moudle 执行后，实现了从 rawModule 到 module 对象的转变。

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
Module 的实例会挂载一些属性，比如 _children 对象用来存放当前 module 的子 module 的对象。_rawModule 属性保存当前模块的配置对象。

然后给 Module 实例添加 state 属性，先获取配置对象中 state 的属性值，如果它为函数，则执行返回值赋给实例的 state 属性，如果不是函数，直接赋给 state 属性，如果它不存在，即当前模块的配置对象没有配置 state，则也赋为一个空对象

可见，用户声明模块的 state 可以传一个返回一个对象的函数，返回的对象会被赋给 this.state。

这和 Vue 组件里的 data 一样，如果使用一个纯对象来声明模块的state，那么这个 state 对象会通过引用被共享，导致 state 对象被修改时，store 或模块间数据相互污染。

因为有时我们可能需要创建一个模块的多个实例，比如，多次实例化 Store 创建多个 store 实例，或在一个 store 中多次注册同一个模块。

```js
get namespaced () {
  return !!this._rawModule.namespaced
}
```

Module 还有一个原型属性 namespaced，通过 Module 实例读取 namespaced 属性时，会读取 Module 原型上的 namespaced，触发了 get 方法，根据模块的配置对象的 namespaced 属性值返回真假

### installModule

new Store 重点的做的三件事，现在我们讲完了模块对象的创建和建立父子关系，接着就是模块的安装，即这句：

```js
installModule(this, state, [], this._modules.root)
```
我们看看installModule：

```js
function installModule(store, rootState, path, module, hot) {
  const isRoot = !path.length 
  const namespace = store._modules.getNamespace(path) 
  if (module.namespaced) {
    if (store._modulesNamespaceMap[namespace] && process.env.NODE_ENV !== 'production') {
      console.error(`[vuex] duplicate namespace ${namespace} for the namespaced module ${path.join('/')}`)
    }
    store._modulesNamespaceMap[namespace] = module
  }
  if (!isRoot && !hot) { 
    const parentState = getNestedState(rootState, path.slice(0, -1))
    const moduleName = path[path.length - 1] 
    store._withCommit(() => { 
      Vue.set(parentState, moduleName, module.state)
    })
  }
  const local = module.context = makeLocalContext(store, namespace, path)
  module.forEachMutation((mutation, key) => {...}) 
  module.forEachAction((action, key) => {...}) 
  module.forEachGetter((getter, key) => {...})
  module.forEachChild((child, key) => {
    installModule(store, rootState, path.concat(key), child, hot)
  })
}
```

我们先看 installModule 函数接收什么参数：

- store：new Vuex.Store 时传入的 store 对象。
- rootState：根 state 对象
- path：当前的模块的路径数组
- module：当前模块对象
- hot：是否支持热重载（这里不讨论它）

installModule 代码较长，我们分段来看

```js
const isRoot = !path.length
const namespace = store._modules.getNamespace(path)
if (module.namespaced) {
  if (store._modulesNamespaceMap[namespace] && process.env.NODE_ENV !== 'production') {
    console.error(`[vuex] duplicate namespace ${namespace} for the namespaced module ${path.join('/')}`)
  }
  store._modulesNamespaceMap[namespace] = module
}
```

首先，变量 isRoot 的真假代表当前模块是否为根模块。接着，调用 getNamespace 根据当前模块的 path 获取当前模块的命名空间。我们看看 ModuleCollection 的原型方法 getNamespace：

```js
getNamespace (path) {
  let module = this.root
  return path.reduce((namespace, key) => {
    module = module.getChild(key)
    return namespace + (module.namespaced ? key + '/' : '')
  }, '')
}
```
getNamespace 首先获取到根 module 对象，然后调用 path.reduce，累加器初始值为 ''，每次迭代返回的字符串覆盖给 namespace，如果当前模块的配置对象中传了 namespaced: true，就将上一次执行回调的返回的字符串，拼上当前的模块名和 '/'，否则拼接''。即开启了命名空间的模块，模块名 key 会加入 namespace 字符串

reduce 迭代结束时，返回出当前模块的命名空间字符串。

```js
if (module.namespaced) {
  if (store._modulesNamespaceMap[namespace] && process.env.NODE_ENV !== 'production') {
    console.error(`[vuex] duplicate namespace ${namespace} for the namespaced module ${path.join('/')}`)
  }
  store._modulesNamespaceMap[namespace] = module
}
```

store 对象的 _modulesNamespaceMap 对象专门存放各个模块的命名空间字符串。

如果当前模块使用了命名空间，且已经存在于 _modulesNamespaceMap，则在开发环境下报错提示：命名空间的名称重复了。如果不存在，则将命名空间和它对应的 module 对象，添加到 _modulesNamespaceMap 对象中。

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
如果当前模块不是根模块，且非热更新，执行 if 语句块。首先，调用 getNestedState 传入根 state 和父 path，获取当前模块的父 state。我们结合 getNestedState 来看：

```js
function getNestedState (state, path) {
  return path.reduce((state, key) => state[key], state)
}
```

父模块的 path 数组调用 reduce，累加器的初始值为根 state，每次迭代返回出它的子模块的 state，沿着path路径，一个个往下获取子 state，直到获取到当前 state 的父 state。就比如`store.state` >> `store.state.a` >> `store.state.a.b`...

`const moduleName = path[path.length - 1]` 获取到当前模块的模块名

接着调用 Store 的原型方法 _withCommit，传入一个回调函数，我们先看看这个回调函数做了什么：

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

开发环境下，假设当前模块名叫 'value'，如果该名称已经存在于父模块（假设模块名叫 foo）的 state 对象中，当你通过 store.state.foo.value 获取父模块 foo 的 state 的 value 值时，你拿到的却是当前 value 模块的配置对象。父模块的 state 的 value 属性被屏蔽了。

因此，如果模块名已存在于父模块的 state 对象中，会给出报错提示。接着：

`Vue.set(parentState, moduleName, module.state)`

用 Vue.set 方法给父模块的 state 对象添加响应式属性，属性名为当前模块名，属性值为模块的 state 对象。于是，用户就能通过父模块的 state 对象中读取当前模块名，获得当前模块的 state 值。并且模块名属性是响应式的。 

我们回头看看 _withCommit 这个 Store 的原型方法

```js
_withCommit (fn) {
  const committing = this._committing
  this._committing = true
  fn()
  this._committing = committing
}
```
_withCommit 接收函数 fn，把当前 store 的 _committing 置为 true，然后执行 fn，再把 _committing 恢复为原来的值。可见，_withCommit 保证了 fn 执行的过程中，_committing 的值为 true。

为什么要这么做？

因为 fn 中含有修改 state 的操作：通过 Vue.set 给父 state 对象添加响应式 state。Vuex 把所有合法修改 state 的操作，都放在 _withCommit 的回调 fn 中进行，保证了过程中的 _committing 为 true，其他时刻都为 false，因此任何在 mutation handler 之外修改 state 的动作都会报错提示。

接下来，注册 mutation、action 等：

```js
const local = module.context = makeLocalContext(store, namespace, path)

module.forEachMutation((mutation, key) => {
  const namespacedType = namespace + key
  registerMutation(store, namespacedType, mutation, local)
})
```

首先执行 makeLocalContext 方法，传入 store 对象，当前模块的命名空间，当前 path，返回值赋给 local 和 module.context。

makeLocalContext 是干嘛的：

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

首先 noNamespace 的真假，代表该模块是否使用了命名空间。然后创建一个对象 local，里面定义了 dispatch、commit 方法，再通过 Object.defineProperties 定义两个属性 getters 和 state，最后返回出 local 对象。

我们先看 local 的 dispatch 方法：

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
Store 原型方法 dispatch 方法用来分发 action 的。我们后面会讲它。

如果当前模块没有使用命名空间，则 local.dispatch 就是 store.dispatch

如果当前模块开启了命名空间，则重新定义 local.dispatch 方法，它可以接收三个参数：
1. _type：即 action 的名称
2. _payload：载荷对象
3. _options：配置对象

这 3 个参数会先传入 unifyObjectStyle 函数执行做参数的归一化处理，返回值赋给 args：

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

如果第一个参数接收的是对象且存在 type 属性，则将传入的第二个参数作为 options ，第一个参数作为 payload，type 则取第一个参数的 type 属性

开发环境下，如果 type 不是字符串，抛出错误。这表明 action mutation 等名称需要是一个字符串。

最后返回出包含 type, payload, options 的对象，再从中解构出 type, payload, options 变量。

```js
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
```

如果用户没有传配置对象或配置对象里没有配置 root，说明用户没有规定把该 action 注册在全局。则将 type 字符串加上命名空间字符串作为前缀。

store._actions 是存放 action 的对象，如果对象中没有名为 type 的 action，说明用户通过 dispatch 想要分发的这个 action 没有注册，报错提示并直接返回。

最后调用 store.dispatch，传入的 type 是加了命名空间的本地 type。

再来看 local.commit，我们知道，store.commit 是提交 mutation 的方法。如果当前模块没有开启命名空间，则 local.commit 就是 store.commit，否则重新定义 local.commit：

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

重新定义的 local.commit 也接收这三个参数，并传入 unifyObjectStyle 做归一化处理：
1. _type：mutation的名字
2. _payload：载荷对象
3. _options：配置对象

然后从返回值中解构出 type, payload, options 变量。

如果用户没有传 options 或没有传 options.root，说明用户没有规定该 mutation 注册在全局，则将 type 字符串加上命名空间字符串作为前缀。

接着判断，如果 store._mutations 这个存放 mutation 的对象里，不存在名为 type 的 mutation，报错提示，告诉用户你要提交的 mutation 不存在，直接返回。

最后调用并返回 store.commit，type 传入的是考虑了命名空间的本地 type。

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

接着继续填充 local 对象，添加两个响应式属性：getters 和 state：

读取 local.getters 时，会触发它的 get 方法，如果当前模块没有开启命名空间，则直接返回 store.getters，即全局的 getters；如果有命名空间，执行返回 makeLocalGetters 函数，传入的是 store 对象和当前的命名空间。

读取 local.state 时，会触发它的 get 方法，通过执行 getNestedState 返回当前模块的 state 对象。

local 对象中的 state 和 getters 属性，都没有设置 set 方法，说明都是只读属性，不能直接修改属性值。

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

如果该缓存对象已经存在当前命名空间，则直接返回其缓存值，如果没有则执行if语句块。

if语句块中，首先定义一个空对象 gettersProxy，然后获取命名空间字符串的长度。然后遍历 store.getters 对象，如果将当前 type 字符串从开头 slice 一个空间字符串的长度，得到的字符串和命名空间字符串不相同，直接返回。继续遍历。

遇到相同的，则获取本地的 getter 名，即去掉前面的命名空间字符串，将它作为只读属性定义在 gettersProxy 对象上，读取它时返回 store.getters 即全局 getters 中对应的 getter。

遍历完后，gettersProxy 对象就存放了该开启了命名空间的模块下的所有本地 getter 名，和它对应的 getter。

然后将 gettersProxy 赋给 store._makeLocalGettersCache[namespace]。

_makeLocalGettersCache 对象中，存放着不同的 namespace 属性，属性值是一个对象，存放该模块下的本地 getter 名和对应的 getter。最后返回出 getter。

可见，makeLocalGetters 就是根据命名空间在全局 getters 对象中找出当前命名空间对应的 getter，创建并返回一个键是本地 getter 名，值是对应的 getter 的对象。通过本地 getter 名就能访问全局 getter 名对应的 getter。

到此 local 对象填充完毕，它里面有：为当前模块设置的本地化的 dispatch、commit 方法，和 getter 和 state 属性

回到 installModule 函数，接下来是注册 mutation，调用 Module 的原型方法 forEachMutation，将回调函数传入执行

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
forEachMutation 函数中，如果当前模块的配置对象传了 mutations，才会遍历该 mutations 对象，对每个键值对执行 fn。

我们看看这个 fn，它首先将 mutation 名加上当前模块的命名空间字符串作为前缀。然后调用 registerMutation 注册 mutation 方法，传入的是考虑了空间字符串的 mutation 名。

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

如果当前遍历的全局 mutation 名在 store._mutations 对象中没有对应的值，则将它添加进去，属性值为一个空数组，用来存放它对应的 mutation。这个数组的引用赋给 entry，方便引用。

接着往 entry 数组推入一个 wrappedMutationHandler 函数，即包裹后的 mutation 函数，它执行，就会执行用户配置的 mutation 函数，执行时 this 指向 store 对象，保证了用户在 mutation 回调中可以通过 this 能引用 store 上的属性和方法。并且传入的是 local.state，这意味着用户在 mutation 中通过局部的 state 名能获取到对应的 state 值。

遍历完当前模块的 mutations 对象后，store._mutations 对象中，每一个全局 mutation 名，都对应一个数组，数组里存放了对应的包裹后的 mutation 函数。

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
如果当前模块的配置对象传了 actions，则遍历 actions 对象，执行 fn。

在 fn 中，如果用户配置 action 时传了 root: true，说明用户在该带命名空间的模块注册全局的 action，则把本地 action 名赋给 type，否则加上命名空间字符串作为前缀。

用户配置 action 时，可以传一个包含 handler 处理函数的对象，也可以直接传函数。handler 获取到 action 的处理函数。

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
      return res.catch(err => {
        store._devtoolHook.emit('vuex:error', err)
        throw err
      })
    } else {
      return res
    }
  })
}
```
如果 store._actions 对象没有当前 action 名对应的值，则初始化为空数组，用来存放 action 名对应的 action。

然后向这个数组中推入 wrappedActionHandler 函数。它是对用户传的 action 函数的封装。

wrappedActionHandler 函数中：首先会调用 handler 函数，返回值赋给 res 缓存起来，执行时的 this 指向 store 对象，handler 函数的第二个参数接收一个 context 对象，它和 store 对象的不同在于：它的 state getters commit dispatch 保存的是局部化的属性和方法。用户可以在 handler 中通过本地的 type 获取到对应的 state getter 等值。

如果执行的返回值 res 不是 promise 实例，则将它包裹为成功值为 res 的 promise 实例，这说明无论用户写 action 函数时有没有返回一个 promise 实例，注册 action 时都会包裹成一个 promise 实例返回。

接着，注册 getter

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
如果当前模块的配置对象中传了 getters，遍历这个 getters 对象，执行回调函数 fn。

在回调函数中，首先获取当前模块的命名空间和 getter 名拼接后的字符串，然后调用 registerGetter 注册 getter

```js
function registerGetter (store, type, rawGetter, local) {
  if (store._wrappedGetters[type]) {
    if (process.env.NODE_ENV !== 'production') {
      console.error(`[vuex] duplicate getter key: ${type}`)
    }
    return
  }
  store._wrappedGetters[type] = function wrappedGetter (store) {
    return rawGetter(
      local.state,
      local.getters,
      store.state,
      store.getters 
    )
  }
}
```
registerGetter 函数中，首先判断，如果当前全局 getter 名已经存在于 store._wrappedGetters 对象中，则报错提示：重复的 getter 名字。然后直接返回。

如果不是，则往 store._wrappedGetters 对象中添加全局 getter 名和对应的 wrappedGetter 方法。它是用户配置的 rawGetter 函数的封装。rawGetter 执行传入的是本地化的 state、getters 和根 state，根 getters。因此用户在书写 getter 函数时，拿获取到这些值。

到此 mutation、action、getter 都注册完了，来到了 installModule 的最后一步，遍历当前模块的子模块，进行子模块的安装：

```js
module.forEachChild((child, key) => {
  installModule(store, rootState, path.concat(key), child, hot)
})
forEachChild (fn) {
  forEachValue(this._children, fn)
}
```

调用 forEachChild 方法，遍历当前模块的 _children 数组存放的所有子模块对象，递归调用 installModule 去安装子模块，传入：store 对象，根 state，子模块的 path，子模块对象本身，和 hot。这样，子模块的 mutation、action、getter 也得到注册。



## resetStoreVM

现在来到实例化 Store 构造函数的核心三件事的最后一件：响应式化 state

>Vuex 的状态存储是响应式的。当 Vue 组件从 store 中读取 state 时，若 store 中的 state 发生变化，那么相应的组件也会相应地得到更新。

也就是，state 对象中的属性被观测了，属性值的变化会触发监听它的依赖。那 Vuex 是如何把 state 对象转成响应式数据呢？靠的是这句：

```js
resetStoreVM(this, state)
```
传入 resetStoreVM 的 this 是 store 对象，state 是根 state，我们看看 resetStoreVM：

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

首先将 store._vm 赋给 oldVm 缓存一下旧值。

然后，给 store 对象上添加 getters 属性，值为一个空对象。再添加 _makeLocalGettersCache 属性，值为一个空对象。

store._wrappedGetters 对象存放的是已注册的 getter 方法。再定义一个 computed 空对象。

遍历已注册的 getter 方法，往 computed 对象添加同名方法，方法值为 partial(fn, store)，下面看看 partial 函数。

```js
function partial (fn, arg) {
  return () => {
    return fn(arg)
  }
}
```

传入 partial 的是已注册的 getter 方法和 store 对象，返回一个新的函数，新函数执行实际执行的是 getter 函数，getter 执行接收 store 对象。

为什么给 computed 对象所添加包裹后的 getter。因为这样 getter 在外部调用时，也能引用 partial 函数作用域中的 store 这个私有形参，形成了闭包，而 partial 的 store 也通过闭包引用了 resetStoreVM 的私有形参 store，所以 store 不会随着 resetStoreVM 函数执行结束而销毁。

如果只是将 getter 方法直接赋给 computed 对象，resetStoreVM 执行完后，store 就不再驻留在内存中了，getter 方法中引用不到 store 对象。

接着往 store.getters 这个空对象添加只读属性：

```js
Object.defineProperty(store.getters, key, {
  get: () => store._vm[key],
  enumerable: true
})
```
属性名是 getter 名，读取它会触发 get 方法，返回 store._vm[key]，即 Vue 实例上的同名属性的属性值。

那么，store._vm 是怎么来的，上面怎么会有 getter 的同名属性的？接着看 resetStoreVM 函数：

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
首先缓存 Vue.config.silent 的值。然后将 Vue.config.silent 置为 true，保证接下来创建 Vue 实例时，Vue 不会打印日志与警告，完后，将它恢复为原来的值。因为借用 Vue 创建实例的过程可能会存在一些不严格的模式，但不希望因此报错。

实例化 Vue 时，`$$state` 会转成响应式属性，它的属性值：根 state 会被深度观测，内部属性也响应式化。

我们知道，安装了 Vuex 后，之后创建的所有 vm 实例能引用到 store 对象。读取 vm.$store.state，即读取 store.state，而 Store 构造函数有 state 这个原型属性，所以会触发 get 方法：
，
```js
get state () {
  return this._vm._data.$$state
}
```

返回的是 store._vm._data.$$state。我们知道，Vue 把 data 数据挂载到 vm 实例的 _data 上，所以 store._vm._data 访问到的是定义的 data 对象，store._vm._data.$$state 访问的是 data 中的 $$state，值为根 state。

这样就实现了，在vm实例中，通过 vm.$store.state 访问根 state 对象，并且 state 对象内部的属性是响应式的。

```js
store._vm = new Vue({
  data: {
    $$state: state
  },
  computed
})
```
并且，computed 对象作为 computed 选项传入 new Vue，它里面存放 getter 名和对应的 getter 方法，会被初始化为计算属性。

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
由 Vue 源码可知，$watch 执行会执行 `function () { return this._data.$$state }` 函数，从而收集创建出来的 watcher，watcher 监听了 `store._vm._data.$$state` 这个数据属性，并且配置对象是 `{ deep: true, sync: true }`，这代表属性值(根 state)会被深度观测，当 state 变化时，watcher 的 update 方法执行，会调用 run 重新求值，并执行 $watch 的回调函数。

在该回调函数中，如果当前 store._committing 为 false，则会抛错：不能在 mutation 函数以外修改 state。所以 enableStrictMode 函数为 state 设置了一个监听，在它被修改时执行回调。

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
如果 oldVm 存在，说明 store.vm 已经存在，现在 resetStoreVM 要创建新的 vm 和 watcher，所以要销毁旧的 vm 实例，但不希望在同步代码中销毁，会阻塞代码的执行，所以调用 nextTick 方法将销毁的操作放到异步队列中。销毁旧的 vm 实例意味着会将创建的 watcher 销毁，不再监听 state 

resetStoreVM 函数就看完了。

## Vuex.Store实例方法的实现
### commit

更改 store 中的 state 只能通过提交 mutation，mutation 非常类似于事件：每个 mutation 都有一个事件类型 type 字符串和一个回调函数 handler，handler 用户书写的，经过 mutation 注册后，它接收 local.state 作为第一个参数。

commit 是 Store 的原型方法，用来提交 mutation：

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
const entry = this._mutations[type]
if (!entry) {
  if (process.env.NODE_ENV !== 'production') {
    console.error(`[vuex] unknown mutation type: ${type}`)
  }
  return
}
```

首先，unifyObjectStyle 函数对参数做统一化处理。再解构出 type, payload, options 变量。

接着，创建一个包含 type 和 payload 的对象 mutation。获取 store 实例的 _mutations 对象中的 type 对应的数组，该数组存放的是该 mutation 名对应的处理函数。

如果该数组不存在，说明该 mutation 没有注册过，所以无法提交该 mutation，在开发环境下要打印警告：未知的 mutation type，直接返回

接下来，继续看：

```js
this._withCommit(() => {
  entry.forEach(function commitIterator (handler) {
    handler(payload)
  })
})
```

遍历 this._mutations[type] 数组，将数组里的 handler 都执行一遍，传入用户调用 commit 时传入的 payload。因为 handler 执行是在修改 state 的值，所以要 _withCommit 的包裹保证 _committing 为 true

接下来是关于订阅 mutation 的，本文不作分析

### dispatch

dispatch 也是 Store 的原型方法，它的作用是触发 action。用户在书写 action 方法通常用 promise 管控异步操作。像这样：

```js
actions: {
  actionA ({ commit }) {
    return new Promise((resolve, reject)=>{
      // 异步操作
    })
  }
}
```

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
先调用 unifyObjectStyle 函数做参数做归一化。归一化后的 type, payload 放入一个对象 action

this._actions[type] 是存放 type 对应的 action 方法的数组。如果该数组不存在，说明该 type 的 action 还没注册，报警提示；未知的 action type，然后直接返回。

接着是遍历 _actionSubscribers 数组，执行 action 的订阅函数。这里不分析了。

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
如果 type 对应的处理函数不止一个，可能每个处理函数都用 promise 管控了异步操作。如果我们只是遍历依次执行这些处理函数：`entry.map(handler => handler(payload))`。返回的数组赋给 result，由于这是同步代码，所以 result 拿到的数组里的 promise 的状态还是 pending，等到异步有了结果，result 数组里的 promise 才会改变状态。

`Promise.all(entry.map(handler => handler(payload)))` 返回一个 promise 实例，map 执行返回的数组里所有 promise 都成功或数组里不包含 promise 时，这个 promise 才会成功，如果其中有一个失败了，则该 promise 失败，失败的原因是第一个失败 promise 的原因

Promise.all 返回的 promise 实例赋给 result，起初是 pending 状态，等所有 promise 都有结果了，则 result 也有结果了。

如果 type 对应的 action 只有一个，则执行它，传入 payload，返回值赋给 result。

我们知道注册 action 时会将处理函数包裹成 wrappedActionHandler 函数，返回的必定是 promise 实例，所以 entry[0](payload) 返回的是 promise 实例。

```js
return result.then(res => {
  // ...
  return res
})
```

所以 result 必定是 promise 实例，result 接着调用 then，对拿到的 res 做一些处理后，返回res。

store.dispatch 最后返回的是 promise。因此用户调用 store.dispatch 的返回值可以继续 then，并且可以在成功回调中拿到 res：

```js
store.dispatch('actionA').then((res) => {
  // ....
})
```
res 是 actionA 函数返回的 promise 里的成功值，如果 handler 有多个，则它是数组。如果只有一个，则它是单个值。

## 辅助函数的实现

### mapState

当你想在一个 Vue 组件中使用一个 state 数据 xxx 时，你可以通过 this.$store.state.xxx，这样每次都这么读取会比较麻烦，你可以将它声明为当前组件的一个计算属性。

但当一个组件需要使用到多个 state 时，将这些 state 都声明为 computed 会有些繁琐。我们可以使用 mapState 这个辅助函数帮助我们生成计算属性

我们看看 mapState 函数的实现：
```js
var mapState = normalizeNamespace(function (namespace, states) {
  var res = {};
  normalizeMap(states).forEach(function (ref) {
    // ...
  });
  return res
});
```

可以看到它是 normalizeNamespace 函数的返回值，normalizeNamespace 做了什么事情：

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
normalizeNamespace 接收一个函数 fn，返回出一个新的函数，因此 mapState 就指向这个新函数，它接收两个参数：namespace 和 map。

做了什么事情？首先判断 namespace，如果不是字符串，就把传入的第一个参数作为 map，namespace 赋值为 ''。如果是字符串，但最后一个字符不是 "/" ，要给 namespace 末尾加上 "/"，也就是说，这个 type 字符串是考虑命名空间的字符串，Vuex 原则上期望你末尾带上 "/"，如果没有带，则会给你都补上。

处理完返回 namespace 字符串后，执行并返回 fn(namespace, map)，即 mapState 执行实际返回 fn 的执行结果，
我们具体看看传入的 fn 是怎么样的：
```js
var mapState = normalizeNamespace(function (namespace, states) {
  var res = {};
  normalizeMap(states).forEach(function (ref) {
    // ...
  });
  return res
});
```

可以看到这个 fn 执行返回 res 对象，normalizeMap(states) 遍历的过程中肯定往 res 对象填充属性了，我们先看看 normalizeMap(states) 返回了什么内容，下面是 normalizeMap 的实现

```js
function normalizeMap (map) {
  return Array.isArray(map)
    ? map.map(key => ({ key, val: key }))
    : Object.keys(map).map(key => ({ key, val: map[key] }))
}
```
normalizeMap(states) 接收 states，就是用户调用 mapState 传入的第二个参数（对象形式）。

normalizeMap 函数中，首先判断这个 states 是否为数组，如果是，将数组每项 key 字符串转成 { key:key, val:key } 这样的对象

如果不是，则默认用户传的是对象，调用 Object.keys 获取 states 对象的所有自有属性组成的数组，然后同样地，将每一项 key 字符串转成 { key: key, val: map[key] }

normalizeMap 其实就是适应用户的不同形式的传参，做的是一种参数的归一化的整理

接着这个归一化后的数组会进行 forEach 遍历，我们具体看看 forEach 的回调函数：

```js
normalizeMap(states).forEach(function (ref) {
  var key = ref.key;
  var val = ref.val;
  res[key] = function mappedState () {
    var state = this.$store.state;
    var getters = this.$store.getters;
    if (namespace) {
      var module = getModuleByNamespace(this.$store, 'mapState', namespace);
      if (!module) {
        return
      }
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

回调函数中，参数 ref 拿到当前遍历的对象，key 拿到对象中的 key 值，val 拿到对象中的 val 值。res 初始是一个空对象，现在遍历的过程，要给它中添加方法，属性值为 key，方法为 mappedState 函数。

mappedState 函数做了什么？

首先 state 变量获取到 store 的 state，getters 变量获取到 store 的 getters。前面提过，如果用户没有给 mapState 传字符串，则 namespace 是空字符串，否则它不为空字符串，则调用 getModuleByNamespace 函数获取到它对应的 module 对象，赋给 module，我们粗略看看 getModuleByNamespace 的实现：

```js
var module = getModuleByNamespace(this.$store, 'mapState', namespace);
// 
function getModuleByNamespace (store, helper, namespace) {
    var module = store._modulesNamespaceMap[namespace];
    if (!module) {
      console.error(("[vuex] module namespace not found in " + helper + "(): " + namespace));
    }
    return module
  }
```
可以看到，传入 getModuleByNamespace 的 3 个参数分别是：

1. store 对象
2. 'mapState'：是一个区分于其他调用的标识
3. namespace：命名空间字符串

首先，会去 store._modulesNamespaceMap 这个存放 namespace 对应的模块的对象，去找出 namespace 对应的 module。

如果 module 没找到，则报错提示：你要找的 namespace 在 _modulesNamespaceMap 对象中找不到对应的模块对象。如果找到了，就把它返回。

前面已经谈过，在实例化 Store 时，已经把所有的模块和它对应的 namespace 都以键值对的形式添加到了 store._modulesNamespaceMap 缓存对象中。

```js
if (namespace) {
  var module = getModuleByNamespace(this.$store, 'mapState', namespace);
  if (!module) {
    return
  }
  state = module.context.state;
  getters = module.context.getters;
}
```
通过 getModuleByNamespace 获取到 module 后，判断 module 不存在就直接返回，因为用户 mapState 传的这个命名空间字符串呢，不一定对应有模块对象，可能是它拼错了这个字符串呢。

然后，state 赋值为module.context.state，这个又是什么，其实我们前面也分析过：

`var local = module.context = makeLocalContext(store, namespace, path);`

它就是 local 对象，是为当前模块设置的本地的包含 dispatch、commit 方法，和 getter 和 state 属性的对象。

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
